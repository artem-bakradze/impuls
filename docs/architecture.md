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
reconciliation → stats sync → budget guard → moderation/balance → approvals expiry → agent inbox;
at 06:00 local time: spend verification, experiments, safety net + evaluation + agent turn, goal advice, outcomes;
on Mondays: stats reconciliation. Tests drive the same handlers with `SimulationDriver` instead of pg-boss.

## Agent (D14)

Each turn is a new session behind `AgentRuntime`; memory lives in our DB (notes, history). Tools resolve the
business from the turn binding; actions go through the command path; explanations are checked against the snapshot.
One turn per business, events merged via `agent_inbox`; settings changes and the kill switch abort a running turn.

## Reconciliation (D15)

Hourly `Changes.checkCampaigns`: SELF → compare campaign; CHILDREN → compare ads; STAT → reload stats.
Spend-affecting drift is clamped by the budget guard; other drift is accepted and logged as «Изменено в кабинете Директа».
