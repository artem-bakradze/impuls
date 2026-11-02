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

## Token usage of a turn (add-agent-insights task 1.1)

What is known without a paid run (SDK `openai@7.45.1` types, the spike run above):

| Source | Type in the SDK | Observed |
| --- | --- | --- |
| `agent.session.turn.completed` / `.cancelled` / `.failed` events | `usage: TokenUsage \| null` | `null` on the spike's completed turn |
| `sessions.turns.retrieve(turnId, { session_id })` | `usage: TokenUsage \| null`, documented as «best-effort, recorded usage may change» | not checked live yet |
| `sessions.retrieve(sessionId)` | `AgentSession.usage: TokenUsage \| null`, cumulative for the session | not checked live yet |

`TokenUsage` has `input_tokens`, `output_tokens` and their breakdowns (cached input, reasoning output).

Implementation (`OpenAiAgentRuntime`, design decision 7 of `add-agent-insights`): the turn's usage is taken from
the terminal turn event; if it is missing, from `turns.retrieve` before the session is deleted; if that is `null` too,
from an estimate with a margin: 2 characters per token (Russian text with JSON is about 2.5–3), and every model step
counted with the conversation it reads at that moment — instructions, tools, the trigger, the calls, their answers and
the texts so far; cached input is not discounted. The source (`api` or
`estimate`) and the tokens are stored with the turn; the worker turns them into kopecks with
`AGENT_PRICE_INPUT_RUB_PER_MTOK` / `AGENT_PRICE_OUTPUT_RUB_PER_MTOK`, rounding up. `pnpm --filter @impuls/worker cli
agent costs --month [YYYY-MM]` sums it per business and shows how many turns were estimated.

### Live check on 2026-10-30 (`packages/agent/spikes/turn-usage-probe.ts`, `gpt-6.1-sol`)

One short turn without tools, session deleted afterwards:

```json
{
  "terminalEvent": "agent.session.turn.completed",
  "eventUsage": null,
  "eventTurnUsage": null,
  "retrieveTurnUsage": null,
  "retrieveSessionUsage": null,
  "retrieveTurnUsageLater": null,
  "deleted": true
}
```

**Verdict: «оценка».** The Agents API reports no usage for a completed turn: not on the event, not on the turn, not on
the session, also 5 seconds later. The runtime keeps reading them (if the API starts to report usage, `source` becomes
`api` by itself), and the estimate is the working path. The OpenAI project budget limit is the outer fuse.

A real daily review through the worker (`apps/worker/spikes/live-agent-turn.ts`, 14 warmed-up days with the rules off,
prices 200 ₽ / 1 000 ₽ per million input / output tokens — $2 / $10 at 100 ₽ per dollar, by third-party price lists
quoting OpenAI): 31 s; the model read the snapshot, paused the ad without leads with an insight on four catalog facts
(spend and leads of the paused ad, leads and cost per lead of the kept one), the day review passed the checks;
estimate 22 678 input and 425 output tokens, 4,97 ₽ (then: the final context times the number of action calls). The
turn's text before its tool calls (the model's plan) was glued to the day review; since then only the message after
the last tool call is the review.

The same turn with the per-step estimate: 41 373 input and 418 output tokens, 8,70 ₽, clean day review. The snapshot
(≈13 thousand tokens with the fact catalog) is read by every step after `get_snapshot`; with OpenAI's cached input
($0.10 instead of $2 per million) the real bill of such a turn is about 3–4 ₽, so the estimate keeps a margin of
about 2×. A month of daily reviews is ≈30 turns: about 260 ₽ per business by the estimate.

Stand check (task 8.4, `AGENT_SIMULATION_RUN_LIMIT_RUB=30`): «Обычный месяц» with the model — the launch turn and the
reviews of days 2 and 3 («данных мало, ничего не меняем», day reviews valid), the run limit spent after the third turn
(≈10 ₽ each by the earlier formula), then the rules decided alone with the day marked «лимит расходов на помощника
исчерпан»; the pult showed «Агент разбирает 1-й день…» while the time stood; 30 days in 6,6 minutes.

## Model choice: `gpt-6-luna` against `gpt-6.1-sol` (2026-10-30)

Prices by third-party lists quoting OpenAI: Luna $0.10 / $0.50, Sol $2 / $10 per million input / output tokens.
There is no `gpt-6.1-luna`; the API lists `gpt-6-luna`. It works in Agents API sessions with our function tools.

- One turn on the same 14 warmed-up days as Sol (instructions 2026-10-30.4): Luna tried to pause the ad without
  leads, its insight was refused for a date in «next» («число 22 не найдено в данных»), and it did not retry — the
  instructions told it not to repeat refused actions — and told the owner the service had refused the pause. Fixed in
  the service: dates and times are not data numbers, and the instructions (2026-10-30.5) say that `INSIGHT_INVALID`
  means «fix the insight and call again». 53 s, ≈0,68 ₽ by the estimate; Sol paused the ad at once in 31 s.
- `pnpm eval:agent` with Luna and 2026-10-30.5 (5 scenarios, 153 turns, scenarios in parallel ≈30 min): the release
  rule passed — cost per lead equal to the rules in every scenario, insights accepted at once 91–100%, day reviews
  valid 97–100%; ≈63 ₽ by the estimate for the whole run (≈0,41 ₽ a turn). After every insight refusal Luna fixed it
  and the next call was accepted. Texts are plain and the numbers right; the day reviews that failed the checks (an
  internal check id, «за 7 и 14 дней») were hidden from the owner, and «7 и 14 дней» and times like «22:00» now pass.
  Weak points: it retried a limit raise the guard refused for the month's budget day after day (the feed now shows a
  repeated refusal once in 3 days) and repeated similar observations; it added no saving over the rules in these
  scenarios — neither does the deterministic test agent, the scenarios are ones the rules already solve.

## Not checked yet

- Egress through `OPENAI_PROXY_URL` from a Russian host (no proxy available; the dev machine reaches OpenAI directly).
- Behaviour under long tool calls (> 1 minute) and session resume after a worker restart.
- Legal side (task 0.7).
