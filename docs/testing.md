# Testing

| Suite | Command | What |
| --- | --- | --- |
| Unit | `pnpm test` | core, platforms (incl. Direct adapter with fake fetch), agent, minisite, worker on the simulator |
| BDD | `pnpm test:bdd` | `tests/bdd/features/<capability>/*.feature` (`# language: ru`), steps in `tests/bdd/steps/` |
| Integration | `pnpm test:integration` | PostgreSQL (`PgStore`, advisory locks, pg-boss, migrations on an empty database) and Mailpit; needs `DATABASE_URL`, `MAILPIT_SMTP_URL`, `MAILPIT_API_URL` |
| Contract | `pnpm test:contract` | Production Direct API in a dedicated test account, drafts only; needs `DIRECT_CONTRACT_TOKEN` and `DIRECT_CONTRACT_LOGIN`, fails fast without them |
| Creatives live check | `pnpm --filter @impuls/agent exec tsx spikes/creatives-live.ts [fixture]` | Card extraction, ads and a variant on the real model; paid (cents), on request only; needs `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL` |
| Live agent turn | `pnpm --filter @impuls/worker exec tsx spikes/live-agent-turn.ts` | One real Agents API turn through the worker on the simulator; paid (cents), on request only; needs `OPENAI_API_KEY`, `OPENAI_AGENT_MODEL` |
| Agent eval | `pnpm eval:agent` | 8 scenarios × 30 simulated days, each with the agent and without it; prints the cost per lead of both. The release rule (`evalVerdict`): on the 5 usual scenarios the agent is not more expensive than the rules, on the 3 analyst ones (junk queries, dear phones, both) at most 90% of them; insights, hypotheses and day reviews pass the checks at once in ≥90% of cases. Weekly reviews run on `OPENAI_STRATEGY_MODEL` when it is set. Paid, on request only; needs `OPENAI_API_KEY`, `OPENAI_AGENT_MODEL`. `pnpm eval:agent --dry-run` checks the harness with `HeuristicPolicy` for free |
| Usability test | manual, before the pilot | 5 real owners go through the wizard on staging without hints; results and fixes in `docs/research/usability.md` (task 12.5). Texts are checked automatically only against the jargon stop-list |

## Simulator and time

`SimulationDriver` (apps/worker/src/simulation.ts) runs the real job handlers hour by hour on a virtual clock
against `SimulatedPlatform` (true ad parameters, stats delays, retroactive corrections, Changes emulation,
cabinet edits, moderation). `workerDown` skips handlers to model outages. Never use real sleeps or pg-boss
schedules in tests.

The same simulator powers the product's simulation mode (`apps/worker/src/simulation-mode.ts`, scenarios in
`scenarios.ts`). `simulation-mode.test.ts` pins what the scenarios must show on a 15 000 ₽ budget with a wizard-like
plan (limits for the scenario's virtual launch day, a month starting on a Sunday and on a Tuesday): dead ads off and
money added by day 14, an A/B verdict by day 30, the cabinet edit on day 5. When a rule changes, run it first: it is
the quickest way to see whether the service still makes decisions on a typical budget. Each scenario's `shows` (what
the checklist expects and by which day) is calibrated on such runs; keep it in line when tuning the truths. BDD: `tests/bdd/features/simulation-mode/`; e2e: `apps/web/e2e/simulation.spec.ts`.

Segments (add-agent-analyst-stage1): an ad's truth may have `queries` and `devices`. Cells stay per ad and hour; the
hour's mix under the campaign's negative phrases and adjustments sets the cell's totals, and a breakdown splits them on
reading with the hour's weights, so it always adds up to the daily stats. Without settings the truth is used as is.
«Обычный месяц» has junk queries made of the plan's first phrase (words the plan's negative phrases do not cut yet) and
dear phones; with `HeuristicPolicy` the stand and `apps/web/e2e/analyst.spec.ts` show a negative phrase with «Почему»
and rollback, and «Разбор недели». Comparisons of two weeks need volume: on a few dozen leads the market's noise
(±15%) is larger than the effect, so the analyst eval scenarios bring a few hundred leads a month.

## Agent policies

Product clarity regression coverage lives in `product-clarity.steps.ts`, `simulation-report.test.ts`,
web `product-clarity.test.ts`, the component suites and `e2e/product-clarity.spec.ts`. The example's generated
aggregates and checked decisions must exactly match the committed fixture; never select a more flattering random run.
The snapshot source and the full market source are deliberately distinct: an observed 13 leads must remain 13 when
the market already contains 14. Comparison tests exclude the current partial calendar day in the business time zone.
The saved report's baseline and goal are frozen too; changing the current ads or stats cannot rewrite that report.

Readiness and recovery tests hold a deterministic operation or inject a report write failure, then explicitly release
or resume the step. They use no real-time sleeps or paid model calls. The mobile e2e checks use 320/360/390/1280 px;
the pult's processing and failure states are also checked with explicit status-response fixtures, without altering a
live business. These fixtures test rendering; worker recovery is tested separately through `SimulationDriver`.

Run CPU-heavy suites separately and use `--maxWorkers=2` on memory-limited Docker installations. For example:
`docker compose exec -T worker pnpm test:bdd --maxWorkers=2`. A killed or timed-out process is a failed check, not a pass.

`IdlePolicy`, `QuietPolicy`, `HeuristicPolicy`, `AdversarialPolicy`, `RandomPolicy`, `ReplayPolicy` implement
`AgentRuntime`. `decides` is false only for `IdlePolicy`: no turns are run for it and the rules act at once, as without
the agent. `QuietPolicy` takes its turns and changes nothing (the rules act as its backup a day later);
`HeuristicPolicy` decides like the rules through the agent tools, with insights on the snapshot's facts, and never
repeats a refused change within 3 days; past «learning» it also cuts queries «дороже цели» by a word that is not in the
own phrases, lowers the price per click of a device that is clearly dearer (it would have brought at least 8 leads at
the other device's cost per lead and brought a third of that or less), and on Mondays closes due hypotheses and writes
one for the week — it is the agent of e2e (`AGENT_RUNTIME=heuristic`), of the BDD simulation and
of `pnpm eval:agent --dry-run`, and with it a simulation repeats exactly after «Начать заново». Guarantees (budget
never exceeded, ineffective ads stopped, effective scaled) are tested under all of them; `compareVerdicts` reports
guardrail regressions on recorded turns. Insights are covered by `tests/bdd/features/insights/` and by the feed model
tests in `apps/web/src/lib/insights-model.test.ts`.

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
