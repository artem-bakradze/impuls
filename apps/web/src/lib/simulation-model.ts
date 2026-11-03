import { isStepComplete } from "@impuls/worker/simulation-report";
import type { SimulationRecord, TurnDigest } from "@impuls/worker";
import { z } from "zod";

/** What the simulation pult shows (simulation-mode spec «Виртуальное время и пульт»). */
export interface SimulationStatus {
  /** Day of the simulation, from 1. */
  day: number;
  totalDays: number;
  /** Virtual «now», ISO. */
  at: string;
  timeZone: string;
  /** `stepping` while «Прожить неделю» or «+1 день» runs; the time stands otherwise. */
  status: "paused" | "stepping";
  /** The step that runs: a week has its number, for «Неделя 2: идёт 10-й день». */
  step: { kind: "week" | "day"; week: number | null } | null;
  /** Weeks lived so far: the newest week story is this one. */
  weeks: number;
  failed?: boolean;
  /** Days left to the scenario's end: below 7 the main action is «Прожить оставшиеся N дней». */
  daysLeft: number;
  /** The scenario's last day is reached; the pult offers to continue. */
  ended: boolean;
  /** How many history entries there are: the pult refreshes the page when it grows. */
  changes: number;
  /**
   * The service is reviewing this virtual day, or the week on a Monday; the step waits meanwhile (add-agent-insights
   * decision 8). A week's review on a model takes minutes, so the pult says so and counts the time.
   */
  agentTurn: { day: number; weekly: boolean } | null;
  /** «Повторить этот прогон» (simulation-mode spec «Повтор прогона»). */
  replay: {
    /** The run had a turn on a model, so it can be repeated without one. */
    available: boolean;
    /** This run repeats the previous one. */
    repeating: boolean;
    /** «Вы изменили ход прогона — дальше сервис решает заново», until the next step. */
    diverged: boolean;
  };
}

/** «Сервис разбирает 8-й день…», or the week's review, which takes longer. */
export const agentTurnText = (turn: { day: number; weekly?: boolean }): string =>
  turn.weekly ? "Сервис разбирает неделю — обычно до 2–3 минут" : `Сервис разбирает ${turn.day}-й день…`;

/** «0:42», «2:05»: how long the service has been reviewing, counted on the owner's screen. */
export const elapsedText = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** «Неделя 2: идёт 10-й день» while a week runs, «Идёт 10-й день» for «+1 день». */
export const stepText = (status: Pick<SimulationStatus, "step" | "day">): string | null =>
  status.step === null ? null : status.step.week !== null ? `Неделя ${status.step.week}: идёт ${status.day}-й день` : `Идёт ${status.day}-й день`;

/** «Прожить неделю», or the days left at the end of the scenario. */
export const stepWeekLabel = (daysLeft: number): string =>
  daysLeft >= 7 ? "Прожить неделю" : daysLeft === 1 ? "Прожить последний день" : `Прожить оставшиеся ${daysLeft} ${daysLeft < 5 ? "дня" : "дней"}`;

export const DIVERGED_TEXT = "Вы изменили ход прогона — дальше сервис решает заново";

const DAY_MS = 86_400_000;

/** Pure: the pult model from the simulation record and the business's journal. */
export const simulationStatusOf = (input: {
  simulation: SimulationRecord;
  timeZone: string;
  changes: number;
  runningTurn: { startedAt: Date; trigger: string } | null;
  turns: readonly Pick<TurnDigest, "status" | "usageSource">[];
}): SimulationStatus => {
  const { simulation } = input;
  const totalDays = Math.round((simulation.endsAt.getTime() - simulation.startedAt.getTime()) / DAY_MS);
  const dayOf = (at: Date) => Math.min(totalDays, Math.floor((at.getTime() - simulation.startedAt.getTime()) / DAY_MS) + 1);
  const weeks = simulation.steps.filter((step) => step.kind === "week" && isStepComplete(step, simulation)).length;
  const current = simulation.status === "stepping" ? simulation.steps.at(-1) : undefined;
  return {
    day: dayOf(simulation.simNow),
    totalDays,
    at: simulation.simNow.toISOString(),
    timeZone: input.timeZone,
    status: simulation.status,
    step: current ? { kind: current.kind, week: current.kind === "week" ? weeks + 1 : null } : null,
    weeks,
    failed: simulation.steps.at(-1)?.state === "failed",
    daysLeft: Math.max(0, Math.ceil((simulation.endsAt.getTime() - simulation.simNow.getTime()) / DAY_MS)),
    ended: simulation.simNow.getTime() + 3_600_000 > simulation.endsAt.getTime(),
    changes: input.changes,
    agentTurn: input.runningTurn ? { day: dayOf(input.runningTurn.startedAt), weekly: input.runningTurn.trigger === "weekly_review" } : null,
    replay: {
      available: input.turns.some((t) => t.status === "completed" && t.usageSource !== null),
      repeating: simulation.replay !== null,
      diverged: simulation.replay !== null && simulation.replay.diverged && !simulation.replay.notified,
    },
  };
};

export type SimulationAction = { action: "step_week" | "step_day" | "extend" | "go_real" } | { action: "restart"; mode: "repeat" | "fresh" };

/** Actions of the old pult: the time no longer runs by itself, so an old page is asked to reload. */
const GONE_ACTIONS = ["pause", "resume", "until_decision", "speed"] as const;

/** Body of a pult action; the old pult's actions parse too, to be answered «обновите страницу». */
export const SimulationControlBody = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["step_week", "step_day", "extend", "go_real"]) }),
  z.object({ action: z.literal("restart"), mode: z.enum(["repeat", "fresh"]) }),
  z.object({ action: z.enum(GONE_ACTIONS) }).passthrough(),
]);

export const isCurrentAction = (body: z.infer<typeof SimulationControlBody>): body is SimulationAction => !(GONE_ACTIONS as readonly string[]).includes(body.action);
