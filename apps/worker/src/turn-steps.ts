import type { BreakdownDimensionName } from "@impuls/agent";

/**
 * A step of a turn, recorded as it is done (simulation-mode «Ход разбора на глазах владельца»): only what is done and
 * passed its checks — a hypothesis or an observation the fact check accepted, a change the executor applied. The words
 * are the screen's: it knows the period's days and the history's words for a change.
 */
export type TurnStep =
  | { kind: "numbers" }
  | { kind: "memory" }
  | { kind: "breakdown"; dimension: BreakdownDimensionName }
  | { kind: "hypothesis_saved"; statement: string }
  | { kind: "hypothesis_closed"; statement: string; status: "confirmed" | "rejected" | "dropped" }
  | { kind: "observation"; text: string }
  | { kind: "change"; changeId: string };

/** The steps a turn's context carries; none for a turn saved before market-leaks-live-review. */
export const turnSteps = (context: unknown): TurnStep[] => {
  const steps = (context as { steps?: unknown } | null)?.steps;
  return Array.isArray(steps) ? (steps as TurnStep[]) : [];
};
