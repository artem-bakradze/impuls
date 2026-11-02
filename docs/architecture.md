# Architecture

Source of truth: `openspec/changes/bootstrap-ad-autopilot-mvp/design.md` (decisions are referenced as D1…D16).

## Components

| Component | Responsibility |
| --- | --- |
| `apps/web` | UI and API routes. Reads PostgreSQL, enqueues `WebJob`s; never calls the ad platform or LLMs (D1, D3). |
| `apps/worker` | The only command executor; job handlers (stats, reconciliation, budget guard, safety net, experiments, agent turns, emails), pg-boss wiring. |
| `packages/core` | Pure domain functions: month budget, limit fitting, ЦСО, classification, `guard()`, safety net, A/B verdict, explanation validator. No I/O. |
| `packages/platforms` | `AdPlatform` contract; `SimulatedPlatform` and `YandexDirectPlatform`. Adapters declare capabilities (strategies, minimum limit). |
| `packages/agent` | `AgentRuntime` port, tool schemas, test policies (idle/adversarial/random/replay). |
| `packages/minisite` | Static mini-site renderer and publisher port (D16). |
| `packages/db` | Drizzle schema and migrations. |

## Dependency rules

- `core` depends on nothing. `platforms`, `agent`, `minisite` depend only on `core`.
- `worker` composes everything; `web` depends on `worker` only for its read model (`PgStore`, `loadBusinessView`) and job types.
- External side effects (platform, OpenAI, SMTP, mini-site hosting) happen only in `worker`.

## Command path (D3)

```
request → per-business advisory lock → expected `before` vs platform state (STATE_CHANGED)
        → guard() + budget-guard on the CURRENT state → change_log (pending, own commit)
        → platform adapter → applied | failed
```

A crash between `pending` and the result is resolved by `CommandExecutor.recoverPending`.
Rollback (`history.ts`) builds inverse commands and runs them through the same path.

## Scheduling (D2)

pg-boss runs one hourly `dispatch-hour` job (singleton queue, no retries). The dispatcher, per business:
reconciliation → stats sync → budget guard → moderation/balance → agent inbox;
at 06:00 local time: spend verification, experiments, evaluation and safety net (same day without the agent; with
the agent: safety net for yesterday's evaluation, then the agent turn), goal advice, outcomes;
on Mondays: stats reconciliation, and at 07:00 local time the agent's weekly review. Tests drive the same handlers
with `SimulationDriver` instead of pg-boss.
The per-business part is `runBusinessHour`; the hourly dispatcher runs it only for businesses in the Direct mode.

## Simulation mode (add-simulation-mode)

A business works in one of two modes, set at launch (`businesses.mode`): `direct` or `simulation`. A simulated
business runs the same handlers, executor, guards and history on its own virtual clock and market:

- `simulations` keeps the scenario, seed, launch plan, virtual `sim_now`, speed, status and the serialized
  `SimulatedPlatform` state (`snapshot`/`restore`, hourly cells older than 3 days merged into daily ones).
- `withSimulation(base, businessId, fn)` loads that world under the lock `sim:<businessId>` and gives `fn` a job
  context with a `ManualClock`, the restored simulator (Direct's strategy catalog and minimum limit), the
  deployment's agent (timed on the real clock) with its cost limit per run, and template A/B variants.
  `handleWebJob` routes every job of a simulated business through it; launch with a scenario goes through
  `launchSimulation`. The agent's snapshot is built from the service's records only; the scenario's truth stays in
  the simulated market.
- The ticker (`startSimulationTicker`, every second in the worker) ticks each running simulation on its own
  (`tickSimulation`; a simulation's tick is not started again while the previous one runs, so a slow agent turn
  delays no other simulation), by real elapsed time × speed, hour by hour: scenario events → `advanceHour` →
  `runBusinessHour` → save. After an hour with a turn of a deciding agent the tick returns, and the real time the
  agent thought is added to `lastTickAt`, so virtual time stands while it thinks (the pult shows «Агент разбирает
  N-й день…» from `runningTurnStartedAt`). At most 6 virtual hours per tick and 3 simulations at once per worker
  (a tick holds up to three lock connections; locks have their own pool in the worker); «До следующего решения»
  stops on the first decision about the ads and is not paced by the real clock (6 virtual hours every tick); «+1 день» (`stepDay`) moves the day in parts that end after each agent
  turn, with the simulation `stepping` meanwhile, so a pause pressed during a turn applies right after it. The worker
  runs up to 5 web jobs at once (`WEB_JOB_CONCURRENCY`), so a long step does not hold up other owners' jobs
  (`isAdDecision` in `change-kinds.ts`: safety net, agent, A/B verdict, cabinet edit; budget-guard limit cuts do not
  count); the end of the 30 days pauses.
- A scenario starts at 09:00 on the 1st of the next month (`scenarioStartDate`; «Конец месяца» 4 days before a
  month ends), and the launch route builds the plan's weekly limits for that date. The default speed is
  «1 день = 10 секунд».
- The control run (`baselineRun`) is computed at launch, restart and extend for the whole horizon and stored by day
  in `simulations.baseline.daily`: the same plan and market without decisions about the ads, with the same
  budget-guard limit cuts, so the screen compares the effect of the decisions day by day.
- Isolation: no Direct platform exists in a simulated context; owner email is skipped; team incidents and
  heartbeats are not written (virtual dates would hide real problems); `recoverPending` of each executor touches
  only its own businesses.
- Web reads use `businessClock(businessId)` and `platformCapabilities(mode)`, so screens show the virtual day.
  Only the `/simulation` screen reads the hidden truth from `simulations.state`.

## Agent (D14, add-agent-insights)

The agent decides by default: migration `0010` sets `agent_enabled = true` globally (per-business «off» switches
stay). `AgentRuntime.decides` tells a deciding runtime from `IdlePolicy`, which decides nothing: for it no turns are
run and the rules act at once. The deterministic rules are the safety net (`safetyNet(..., agentActed)`): after a
completed turn of a deciding agent they wait 24 hours and do what it left; without such a turn (agent off,
unavailable, out of its cost limit) they act on the evaluation the same day, and the day is marked with the reason
(`RULES_DAY` in `insights`).

Each turn is a new session behind `AgentRuntime`; what it knows of the past comes from our DB (history,
experiments, its recent insights via `get_recent_insights`). Tools resolve the business from the turn binding;
actions go through the command path. One turn per business, events merged via `agent_inbox`; settings changes and
the kill switch abort a running turn.

**Insights.** The turn's snapshot carries a fact catalog (`factCatalog` in `apps/worker/src/insights.ts`): spend,
impressions, clicks, leads and cost per lead for 14 days, the last 7 and the 7 before, by ad, by advertising and by
platform; the month's budget, spent, left and even pace; the goal. Every action tool takes an `insight` (reason
code, observation, 2–4 fact keys, next step); `report_insight` adds a decision without an action. `validateInsight`
(`packages/core`) refuses unknown fact keys and numbers that are not in the catalog before anything is executed
(`INSIGHT_INVALID`). The stored insight takes the values of its facts from the snapshot and «Что решили» from the
executor's answer (applied, clamped with the guard's message, refused); the history entries link to it
(`change_log.insight_id`). Rules write insights from templates on the facts they acted on; budget-guard limit cuts do
not. The turn's message to the owner is the day review when it passes the same checks (`summary_valid`). The web
feed (`feedDays` in `apps/web/src/lib/insights-model.ts`) groups insights by day under the review, newest first.

**Costs.** Token usage comes from the turn event, then `sessions.turns.retrieve`, else an estimate with a margin
(`docs/research/agents-api.md`); the worker turns it into kopecks with the configured prices and stores it with the
turn. A turn does not start once the business's month (or the simulation run) has spent its limit.

**Analyst (add-agent-analyst-stage1).** Breakdowns are read tools, not part of the snapshot: `get_breakdown
{ directionId, dimension: query | device }` asks the platform (`AdPlatform.getBreakdown`) for 14 days and caches the
answer for the turn. Search queries pass the privacy filter first (`filterQueries` in `packages/core/src/segments.ts`:
at least 2 clicks or 10 impressions, no 5+ digits, «@» or site addresses, the 30 most expensive; the agent gets only
the number hidden). Each row carries the service's verdict (`segmentVerdict`: «в цели», «дороже цели», «собираем
данные») and its facts join the turn's catalog under `segment:<directionId>:<dimension>:<segmentId>:<metric>:14d`, so
an insight on a segment the agent did not ask for is refused. Query answers also carry the direction's own phrases and
negative phrases, device answers the current adjustments and the day each changed.

The levers are commands like the others: `AddNegativeKeywords`, `RemoveNegativeKeywords` (rollbacks and the owner) and
`SetDeviceAdjustment` (phones, or computers with tablets). The executor reads the current list and adjustments with
`getTrafficSettings` for the expected-state check and hands the guard a fresh breakdown (`GuardState.analyst`), never
the turn's cache: no cutting the own phrases, a query must be «дороже цели», 10 phrases a day; adjustments −50…+50, a
step of 25 points, once in 7 days per device, not on «собираем данные»; the owner's rollback is respected 14 days per
phrase and per device. History entries keep the sorted list (JSON) and the percents; a rollback undoes exactly the
entry's difference and chains only later entries that changed the same phrase or device. Reconciliation takes cabinet
changes of these settings as «Изменено в кабинете Директа» and, once per business, fills them in silently for
directions launched before they were kept; both write under the business lock.

The weekly review is a turn with the `weekly_review` trigger (Monday 07:00, after the day's review): the strategy model
when `OPENAI_STRATEGY_MODEL` is set (`JobContext.strategist`, its own prices), else the daily one; the instructions get
the weekly block (`instructionsFor`, version `<daily>+weekly.<version>`); the spend counts in the same limits. The
hypothesis journal (`hypotheses` table; `get_hypotheses`, `save_hypothesis`) is the agent's memory between turns: texts
checked like insights, at most 10 open. The feed shows the review as «Разбор недели» with «Выяснили» and «Проверяем».
The safety net never uses these levers.

## Reconciliation (D15)

Hourly `Changes.checkCampaigns`: SELF → compare campaign, then its negative phrases and device adjustments;
CHILDREN → compare ads; STAT → reload stats.
Spend-affecting drift is clamped by the budget guard; other drift is accepted and logged as «Изменено в кабинете Директа».
