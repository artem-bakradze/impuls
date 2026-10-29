# Testing

| Suite | Command | What |
| --- | --- | --- |
| Unit | `pnpm test` | core, platforms (incl. Direct adapter with fake fetch), agent, minisite, worker on the simulator |
| BDD | `pnpm test:bdd` | `tests/bdd/features/<capability>/*.feature` (`# language: ru`), steps in `tests/bdd/steps/` |
| Integration | `pnpm test:integration` | PostgreSQL (`PgStore`, advisory locks, pg-boss) and Mailpit; needs `DATABASE_URL`, `MAILPIT_SMTP_URL`, `MAILPIT_API_URL`, `S3_TEST_ENDPOINT` (S3Mock) |
| Contract | `pnpm test:contract` | Production Direct API in a dedicated test account, drafts only; needs `DIRECT_CONTRACT_TOKEN` and `DIRECT_CONTRACT_LOGIN`, fails fast without them |
| Creatives live check | `pnpm --filter @impuls/agent exec tsx spikes/creatives-live.ts [fixture]` | Card extraction, ads and a variant on the real model; paid (cents), on request only; needs `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL` |
| Agent eval | `pnpm eval:agent` | not available until the OpenAI Agents API runtime exists (task 10.12) |

## Simulator and time

`SimulationDriver` (apps/worker/src/simulation.ts) runs the real job handlers hour by hour on a virtual clock
against `SimulatedPlatform` (true ad parameters, stats delays, retroactive corrections, Changes emulation,
cabinet edits, moderation). `workerDown` skips handlers to model outages. Never use real sleeps or pg-boss
schedules in tests.

## Agent policies

`IdlePolicy`, `AdversarialPolicy`, `RandomPolicy`, `ReplayPolicy` implement `AgentRuntime`. Guarantees
(budget never exceeded, ineffective ads stopped, effective scaled) are tested under all of them;
`compareVerdicts` reports guardrail regressions on recorded turns.

## Direct contract tests

Yandex shut the Direct sandbox down on 2026-07-15, so contract tests use the production API. The test account may hold
real campaigns, so every request goes through `ContractGuard` (packages/platforms/src/yandex-direct/contract-guard.ts):

- before the first write, `Clients.get` must return `DIRECT_CONTRACT_LOGIN`, RUB and a non-agency account; error 58
  (application not approved) stops the run;
- campaigns are created only with the reserved prefix `impuls-contract-` (the service uses `[Импульс] …`);
- changes, pauses and deletions are allowed only for objects created by this run; prefixed drafts of interrupted runs
  may only be deleted;
- `moderate` and anything outside an allowlist of methods is refused before the request is sent, so test campaigns
  stay unserved drafts and cost nothing;
- campaigns without the prefix are compared before and after the run, and the request journal is checked for the token.

Limits: a draft campaign cannot really be paused, moderation and statistics stay empty; those are confirmed in the
pilot. Runs spend API points of the test account, so they are not scheduled.

## Notable checks

- 200 simulated months with an adversarial agent, cabinet limit raises and 48-hour outages: zero overruns.
- Every reversible MVP command: command → rollback → original state.
- Agent context intercept: no email, phone, user IDs or tokens.
