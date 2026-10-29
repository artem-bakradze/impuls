# OpenAI Agents API spike

Task 0.6 of `bootstrap-ad-autopilot-mvp`. Run on 2026-10-29 from the developer machine (no egress proxy needed
from there), SDK `openai@7.45.1`, model `gpt-6.1-sol`. Prototype: `packages/agent/spikes/agents-api-spike.ts`.

## What was checked

| Item | Result |
| --- | --- |
| Session with `environment: { type: "none" }` | Works. `input` is required at creation for `none`, so a turn starts immediately |
| Model `gpt-6.1-sol` in a session | Accepted. Official examples use `gpt-6-astra`; no published list of supported models |
| Caller-executed function tools (`type: "function"`) | Work through the SDK `toolHandlers` (see below) |
| Event stream | `agent.session.created` → `turn.created` → `turn.in_progress` → item / text events → `requires_action` (tool call pending) → `turn.completed` / `turn.cancelled` / `turn.failed` → `session.idle` |
| Cancel a turn | `events.create(session, { events: [{ type: "agent.session.input.cancel" }] })` → `agent.session.turn.cancelled` within ~10 s |
| Delete a session | `sessions.delete(id)` → `{ deleted: true }` |
| Per-session spend limit `spend_control` | **Not available**: present in SDK 7.45.1 types, the API answers 400 `Unknown parameter: 'spend_control'` |

## Findings that change the implementation (task 10.1)

1. **Answer tool calls the SDK way.** Use `toolHandlers` on `sessions.create` / `sessions.stream`. The SDK answers on
   `agent.session.turn.item.added` (item type `function_call`) and retries `Unknown pending tool call` (100/300/600 ms)
   until the server registers the call. A hand-written reply on `turn.item.done` was accepted with 202 but never reached
   the model: it waited ~4 minutes and ended the turn saying the data did not arrive. HTTP 202 means «accepted», not
   «delivered».
2. **Cancel races with tool results.** After `input.cancel`, a pending tool result submission fails with 409
   (`managed agent turn … is not active` or `the server request is no longer pending`), and the SDK rethrows it from
   the event iteration. `AgentRuntime` must treat
   409 after its own cancel as the normal end of a cancelled turn and still delete the session.
3. **No spend limit per session.** Cost is bounded by the project budget limit in the OpenAI dashboard, the turn
   timeout in the worker and the number of turns (one per business per day plus events). Revisit when
   `spend_control` reaches the API.
4. **Tool handlers must not throw for business refusals.** A thrown handler is reported to the model as the generic
   «Tool handler failed.»; guard refusals must be returned as normal results (`{ status: "rejected", reason }`), which
   `ToolResult` in `packages/agent` already does.
5. **Sessions are listable by metadata** (`metadata: { purpose }`), so leftovers of crashed turns can be found and
   deleted by a cleanup job.

## Turn results

Daily-evaluation turn on a snapshot with one effective ad (6 leads at ≈517 ₽, goal 800 ₽) and one ineffective ad
(2 600 ₽, 0 leads):

- tool calls: `get_snapshot` → `pause_ad({ adId: "a2", justification: "За 14 дней объявление «Маникюр без записи»
  потратило 2600 ₽ и не принесло ни одного обращения при целевой стоимости обращения 800 ₽…" })`;
- final text for the owner, plain Russian, correct numbers: «Поставил на паузу объявление «Маникюр без записи»: за
  14 дней потрачено 2 600 ₽ без единого обращения. «Маникюр у метро» оставил работающим: оно принесло 6 обращений по
  ≈517 ₽ — дешевле целевых 800 ₽»;
- duration 17 s from session creation to `turn.completed`;
- token usage is not on the `turn.completed` event (`turn.usage` was empty); cost per turn has to be read from the
  usage dashboard or the turns API — to check in task 10.1.

Cancel during a tool call: the second run cancelled right at `turn.in_progress`, while the SDK was answering
`get_snapshot`; iteration threw 409 `the server request is no longer pending` (finding 2). An earlier run that
cancelled before any tool call ended cleanly with `agent.session.turn.cancelled` in ~10 s.

Cleanup by metadata found and deleted three sessions left by the crashed runs.

## Verdict

The Agents API fits design decision 14: one session per turn with environment `none`, our function tools, a stream we
read from the worker, cancel and delete. `gpt-6.1-sol` made the expected decision and explained it in plain language.
Task 0.6 stays open only for the proxy check from the chosen hosting location (needs task 0.5).

## Implementation (task 10.1)

`OpenAiAgentRuntime` (`packages/agent/src/openai-runtime.ts`), enabled with `AGENT_RUNTIME=openai` and
`OPENAI_AGENT_MODEL`:

- tool calls are answered by the SDK `toolHandlers`; guard refusals come back as normal results;
- the client runs with `maxRetries: 0`: the SDK retries 409 and 5xx by default, which would re-create a streaming
  session (a second turn) or resend a tool result to a cancelled turn;
- cancel on the worker's abort signal, 409 after it ends the turn as cancelled, the session is deleted in every
  outcome;
- offered tools: all action tools, `get_snapshot`, `get_notes`, `save_note` (`get_history` and `delete_note` are not
  served by the worker's toolbox yet);
- instructions are versioned in `packages/agent/src/instructions.ts` and stored with every turn.

Contract tests replay a real turn recorded at the HTTP level (`fixtures/agent-turn-daily-review.json`, made by
`spikes/record-agent-turn.ts`): the same tool calls are answered in the same order, the pause goes through the toolbox
and the session is deleted. Synthetic streams cover cancel-with-409 and `turn.failed`.

Live turns through the worker on the simulator (`apps/worker/spikes/live-agent-turn.ts`, 20 warmed-up days):
25–28 s per turn, journal entry with runtime and instructions version. The first run showed that the snapshot had no
signal for «held back by the limit», so the agent never scaled effective directions; `spend7Rub` was added to the
snapshot and the scaling rule to the instructions (version 2026-10-29.2). With it the agent correctly left both
directions alone because their weekly spend was below 90% of the limits.

## Not checked yet

- Egress through `OPENAI_PROXY_URL` from a Russian host (no proxy available; the dev machine reaches OpenAI directly).
- Behaviour under long tool calls (> 1 minute) and session resume after a worker restart.
- Legal side (task 0.7).
