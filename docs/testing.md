# Testing

| Suite | Command | What |
| --- | --- | --- |
| Unit | `pnpm test` | core, platforms (incl. Direct adapter with fake fetch), agent, minisite, worker on the simulator |
| BDD | `pnpm test:bdd` | `tests/bdd/features/<capability>/*.feature` (`# language: ru`), steps in `tests/bdd/steps/` |
| Integration | `pnpm test:integration` | PostgreSQL (`PgStore`, advisory locks, pg-boss) and Mailpit; needs `DATABASE_URL`, `MAILPIT_SMTP_URL`, `MAILPIT_API_URL` |
| Contract | `pnpm test:contract` | Yandex Direct sandbox; needs `DIRECT_SANDBOX_TOKEN`, fails fast without it |
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

## Notable checks

- 200 simulated months with an adversarial agent, cabinet limit raises and 48-hour outages: zero overruns.
- Every reversible MVP command: command → rollback → original state.
- Agent context intercept: no email, phone, user IDs or tokens.
