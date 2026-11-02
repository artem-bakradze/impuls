/** What the simulation pult shows (simulation-mode spec «Виртуальное время и пульт»). */
export interface SimulationStatus {
  /** Day of the simulation, from 1. */
  day: number;
  totalDays: number;
  /** Virtual «now», ISO. */
  at: string;
  timeZone: string;
  status: "running" | "paused" | "until_decision" | "stepping";
  speed: "fast" | "minute" | "real";
  /** The scenario's last day is reached; the pult offers to continue. */
  ended: boolean;
  /** How many history entries there are: the pult refreshes the page when it grows. */
  changes: number;
  /** The newest change made by the service itself, for «До следующего решения». */
  lastDecision: { id: string; explanation: string } | null;
  /** The agent is reviewing this virtual day; the virtual time stands meanwhile (add-agent-insights decision 8). */
  agentTurn: { day: number } | null;
}

/** «Агент разбирает 8-й день…» */
export const agentTurnText = (turn: { day: number }): string => `Агент разбирает ${turn.day}-й день…`;

export const SPEED_LABELS: Record<SimulationStatus["speed"], string> = {
  fast: "1 день = 10 секунд",
  minute: "1 день = 1 минута",
  real: "Реальное время",
};

export type SimulationAction =
  | { action: "pause" | "resume" | "until_decision" | "step_day" | "extend" | "restart" | "go_real" }
  | { action: "speed"; speed: SimulationStatus["speed"] };
