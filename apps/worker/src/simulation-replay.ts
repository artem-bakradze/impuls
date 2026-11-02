import type { AgentRuntime, BreakdownDimensionName, HypothesisDraft, ToolCallRecord, TurnResult } from "@impuls/agent";
import type { Clock } from "./clock";
import type { AdRecord, AgentTurnRecord, ChangeEntry, DirectionRecord, ReplayOwnerAction, ReplayTurn, SimulationRecord, SimulationReplay, Store } from "./store";

const HOUR_MS = 3_600_000;

/**
 * What «Повторить этот прогон» replays (simulation-mode spec «Повтор прогона»): the run's completed turns in the
 * order they ran, and the owner's actions. Null when the run had no turn on a model: then there is nothing to save.
 */
export const recordReplay = (
  turns: readonly AgentTurnRecord[],
  changes: readonly ChangeEntry[],
  directions: readonly DirectionRecord[],
  ads: readonly AdRecord[],
): SimulationReplay | null => {
  const completed = turns.filter((t) => t.status === "completed").sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  if (!completed.some((t) => t.usageSource !== null)) return null;
  const ids = stableIds(directions, ads);
  return {
    turns: completed.map(
      (t): ReplayTurn => ({
        at: t.startedAt,
        trigger: t.trigger,
        summary: t.summary ?? "",
        calls: (t.calls as ToolCallRecord[]).map((c) => ({ command: c.command, insight: c.insight, accepted: c.result.status !== "rejected" })),
        hypotheses: ((t.context as { hypotheses?: { draft: HypothesisDraft }[] } | null)?.hypotheses ?? []).map((h) => h.draft),
      }),
    ),
    ownerActions: ownerActionsOf(changes, ids),
    ids,
    position: 0,
    diverged: false,
    notified: false,
  };
};

/** Object id → the simulated platform's id, which is the same in every run of the scenario. */
const stableIds = (directions: readonly DirectionRecord[], ads: readonly AdRecord[]): Record<string, string> => ({
  ...Object.fromEntries(directions.map((d) => [d.id, `campaign:${d.platformCampaignId}`])),
  ...Object.fromEntries(ads.map((a) => [a.id, `ad:${a.platformAdId}`])),
});

const ownerActionsOf = (changes: readonly ChangeEntry[], ids: Readonly<Record<string, string>>): ReplayOwnerAction[] =>
  changes
    .filter((c) => c.actor === "user")
    .map((c) => ({ at: c.createdAt, type: c.action.type, objectId: ids[c.objectId] ?? c.objectId }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

const sameHour = (a: Date, b: Date): boolean => Math.floor(a.getTime() / HOUR_MS) === Math.floor(b.getTime() / HOUR_MS);

/** The owner did the same so far: the same actions on the same objects in the same virtual hours. */
const sameOwnerActions = (recorded: readonly ReplayOwnerAction[], now: readonly ReplayOwnerAction[], until: Date): boolean => {
  const before = recorded.filter((a) => a.at.getTime() <= until.getTime());
  return before.length === now.length && before.every((a, i) => {
    const b = now[i];
    return b !== undefined && a.type === b.type && a.objectId === b.objectId && sameHour(a.at, b.at);
  });
};

/** A recorded turn with the old run's object ids replaced by the new run's (in commands and fact keys alike). */
const carriedOver = (turn: ReplayTurn, recordedIds: Readonly<Record<string, string>>, currentIds: Readonly<Record<string, string>>): ReplayTurn => {
  const byStable = new Map(Object.entries(currentIds).map(([id, stable]) => [stable, id]));
  let text = JSON.stringify({ calls: turn.calls, hypotheses: turn.hypotheses });
  for (const [oldId, stable] of Object.entries(recordedIds)) {
    const newId = byStable.get(stable);
    if (newId !== undefined && newId !== oldId) text = text.split(oldId).join(newId);
  }
  return { ...turn, ...(JSON.parse(text) as Pick<ReplayTurn, "calls" | "hypotheses">) };
};

/** The breakdowns a recorded turn read: its insights and hypotheses cite their facts by `segment:<direction>:<dimension>:…`. */
const breakdownsOf = (turn: ReplayTurn): [string, BreakdownDimensionName][] => {
  const keys = [...turn.calls.flatMap((c) => c.insight.factKeys), ...(turn.hypotheses as HypothesisDraft[]).flatMap((h) => h.factKeys)];
  const pairs = new Map<string, [string, BreakdownDimensionName]>();
  for (const key of keys) {
    const [prefix, directionId, dimension] = key.split(":");
    if (prefix === "segment" && directionId && (dimension === "query" || dimension === "device")) pairs.set(`${directionId}:${dimension}`, [directionId, dimension]);
  }
  return [...pairs.values()];
};

/**
 * The agent of a repeated run: the recorded turns, through the same tools and guards, with their summaries and no
 * model spend. It turns into the live agent for good when the run goes elsewhere — the owner acts differently, a turn
 * comes at another time or for another trigger, or a recorded call is refused now — and says so once on the pult.
 */
export const replayRuntime = (input: {
  live: AgentRuntime;
  clock: Clock;
  store: Store;
  businessId: string;
  record: () => SimulationRecord;
  update: (replay: SimulationReplay) => void;
}): AgentRuntime => ({
  name: input.live.name,
  instructionsVersion: input.live.instructionsVersion,
  decides: true,
  runTurn: async (turn: Parameters<AgentRuntime["runTurn"]>[0]): Promise<TurnResult> => {
    const replay = input.record().replay;
    if (replay === null || replay.diverged) return input.live.runTurn(turn);
    const now = input.clock.now();
    const next = replay.turns[replay.position];
    const current = stableIds(await input.store.directions(input.businessId), await input.store.ads(input.businessId));
    const owner = ownerActionsOf(await input.store.changes(input.businessId), current);
    if (next === undefined || next.trigger !== turn.trigger.kind || !sameHour(next.at, now) || !sameOwnerActions(replay.ownerActions, owner, now)) {
      input.update({ ...replay, diverged: true });
      return input.live.runTurn(turn);
    }
    const recorded = carriedOver(next, replay.ids, current);
    for (const [directionId, dimension] of breakdownsOf(recorded)) await turn.tools.breakdown(directionId, dimension);
    const calls: ToolCallRecord[] = [];
    let refused = false;
    for (const call of recorded.calls) {
      const result = call.command === null ? await turn.tools.observe({ ...call.insight, decision: call.insight.decision ?? "" }) : await turn.tools.act(call.command, call.insight);
      calls.push({ command: call.command, insight: call.insight, result });
      if (call.accepted && result.status === "rejected") refused = true;
    }
    for (const draft of recorded.hypotheses as HypothesisDraft[]) await turn.tools.saveHypothesis(draft);
    input.update({ ...replay, position: replay.position + 1, diverged: refused });
    return { summary: next.summary, calls, usage: null };
  },
});
