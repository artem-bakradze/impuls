import { isStepComplete } from "@impuls/worker/simulation-report";
import { PERIOD_DAYS } from "@impuls/worker/simulation-period";
import type { PeriodAdInput, PeriodDays, PeriodForm, PeriodMarket } from "@impuls/worker/simulation-period";
import type { SimulationRecord } from "@impuls/worker";
import { z } from "zod";

/** What the simulation's player shows (simulation-mode spec «Симуляция как отдельный режим»). */
export interface SimulationStatus {
  /** Day of the simulation, from 1. */
  day: number;
  /** Virtual «now», ISO. */
  at: string;
  timeZone: string;
  /** `stepping` while a period goes; the time stands otherwise. */
  status: "paused" | "stepping";
  /** The days of the period that goes, from 1. */
  step: { from: number; to: number } | null;
  /** Periods lived so far, with the weeks and days of older runs. */
  periods: number;
  failed?: boolean;
  /** How many history entries there are: the player refreshes the page when it grows. */
  changes: number;
  /** The service is reviewing the period; the player counts the time meanwhile. */
  agentTurn: boolean;
  /** «Добавить статистику»: the ads shown now and what Direct would spend on each direction. */
  form: PeriodForm;
}

/** «дни 9–15», «день 9». */
export const periodDaysText = (step: { from: number; to: number }): string => (step.from === step.to ? `день ${step.from}` : `дни ${step.from}–${step.to}`);

/** «Сервис разбирает дни 9–15…» while a period goes. */
export const periodReviewText = (step: { from: number; to: number }): string => `Сервис разбирает ${periodDaysText(step)}…`;

/** «0:42», «2:05»: how long the service has been reviewing, counted on the owner's screen. */
export const elapsedText = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const DAY_MS = 86_400_000;

/** Pure: the player's model from the simulation record, the business's journal and the window's form. */
export const simulationStatusOf = (input: {
  simulation: SimulationRecord;
  timeZone: string;
  changes: number;
  runningTurn: { startedAt: Date; trigger: string } | null;
  form: PeriodForm;
}): SimulationStatus => {
  const { simulation } = input;
  const dayOf = (at: Date) => Math.floor((at.getTime() - simulation.startedAt.getTime()) / DAY_MS) + 1;
  const current = simulation.status === "stepping" ? simulation.steps.at(-1) : undefined;
  return {
    day: dayOf(simulation.simNow),
    at: simulation.simNow.toISOString(),
    timeZone: input.timeZone,
    status: simulation.status,
    step: current ? { from: dayOf(current.from), to: Math.max(dayOf(current.from), dayOf(current.to) - 1) } : null,
    periods: simulation.steps.filter((step) => isStepComplete(step, simulation)).length,
    failed: simulation.steps.at(-1)?.state === "failed",
    changes: input.changes,
    agentTurn: input.runningTurn !== null,
    form: input.form,
  };
};

/** `market` — the period's marks (simulation-breakdowns); a page from before sends none, and the period is even. */
export type SimulationAction = { action: "period"; days: PeriodDays; ads: PeriodAdInput[]; market?: PeriodMarket } | { action: "continue" | "restart" | "new_campaign" };

/** The player's menu (simulation-mode «Симуляция как отдельный режим»); no «Запустить по-настоящему» since demo-login. */
export const PLAYER_MENU = [
  { action: "restart", label: "Начать заново" },
  { action: "new_campaign", label: "Новая кампания" },
] as const satisfies readonly { action: SimulationAction["action"]; label: string }[];

/**
 * Actions of older players, answered «обновите страницу»: the time no longer runs by itself or by days and weeks, and
 * there is no «Запустить по-настоящему» since the mode follows the login (demo-login).
 */
const GONE_ACTIONS = ["pause", "resume", "until_decision", "speed", "step_week", "step_day", "extend", "go_real"] as const;

const count = z.number().int().min(0).max(100_000_000);

/** Body of a player action; the older players' actions parse too, to be answered «обновите страницу». */
export const SimulationControlBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("period"),
    days: z.union(PERIOD_DAYS.map((d) => z.literal(d)) as [z.ZodLiteral<1>, z.ZodLiteral<3>, z.ZodLiteral<7>, z.ZodLiteral<14>]),
    ads: z.array(z.object({ adId: z.string().min(1), impressions: count, clicks: count, leads: count, spendRub: count })).max(500),
    market: z.object({ junkQuery: z.boolean(), phonesWorse: z.boolean() }).strict().optional(),
  }),
  z.object({ action: z.enum(["continue", "new_campaign"]) }),
  // «Повторить этот прогон» of the older player is gone; its «Прогнать заново» is today's «Начать заново».
  z.object({ action: z.literal("restart"), mode: z.enum(["repeat", "fresh"]).optional() }),
  z.object({ action: z.enum(GONE_ACTIONS) }).passthrough(),
]);

/** Today's action of a parsed body, or null for an action of an older player. */
export const currentAction = (body: z.infer<typeof SimulationControlBody>): SimulationAction | null => {
  if ((GONE_ACTIONS as readonly string[]).includes(body.action)) return null;
  if (body.action === "restart") return "mode" in body && body.mode === "repeat" ? null : { action: "restart" };
  return body as SimulationAction;
};
