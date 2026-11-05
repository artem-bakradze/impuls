import { z } from "zod";
import type { DailyStatRow, SimulatorState } from "@impuls/platforms";
import type { AdRecord, ChangeEntry, DirectionRecord, HypothesisRecord, InsightRecord, SimulationBaseline, SimulationRecord, SimulationStep, TurnDigest } from "./store";

/** Only public ad data, aggregates and checked explanations; never a user or agent context. */
export interface SimulationWeekReport {
  version: 1;
  at: string;
  cso: number;
  monthlyBudgetRub: number;
  endsAt: string;
  baseline: SimulationBaseline | null;
  stats: DailyStatRow[];
  directions: DirectionRecord[];
  ads: AdRecord[];
  changes: ChangeEntry[];
  insights: InsightRecord[];
  turns: TurnDigest[];
  hypotheses: HypothesisRecord[];
  truths: SimulatorState["truths"];
  fullDaily: { date: string; spend: number; leads: number }[];
}

const record = z.object({ id: z.string() }).passthrough();
const reportSchema = z.object({
  version: z.literal(1), at: z.iso.datetime(), cso: z.number().nonnegative(), monthlyBudgetRub: z.number().positive(),
  endsAt: z.iso.datetime(), baseline: z.object({ days: z.number(), spend: z.number(), leads: z.number(), daily: z.array(z.object({ spend: z.number(), leads: z.number() })) }).nullable(),
  stats: z.array(z.object({ date: z.string(), campaignId: z.string(), adId: z.string(), impressions: z.number(), clicks: z.number(), leads: z.number(), spend: z.number() })),
  directions: z.array(record.extend({ channel: z.enum(["search", "network"]), platformCampaignId: z.string() })),
  ads: z.array(record.extend({ title: z.string(), createdOn: z.string(), directionId: z.string(), platformAdId: z.string() })),
  changes: z.array(record.extend({ createdAt: z.date(), before: z.object({}).passthrough(), after: z.object({}).passthrough(), action: z.object({ type: z.string() }).passthrough() })),
  insights: z.array(record.extend({ createdAt: z.date(), facts: z.array(z.object({}).passthrough()), decision: z.object({}).passthrough() })),
  turns: z.array(record.extend({ startedAt: z.date() })),
  hypotheses: z.array(record.extend({ openedAt: z.date(), closedAt: z.date().nullable() })),
  truths: z.array(z.tuple([z.string(), z.object({}).passthrough()])),
  fullDaily: z.array(z.object({ date: z.string(), spend: z.number(), leads: z.number() })),
});

const DATE_KEYS = new Set(["createdAt", "startedAt", "openedAt", "closedAt"]);

/** Reject incomplete/new-version reports instead of manufacturing zero results. */
export const readWeekReport = (serialized: string): SimulationWeekReport => {
  const value: unknown = JSON.parse(serialized, (key: string, item: unknown) => DATE_KEYS.has(key) && typeof item === "string" ? new Date(item) : item);
  reportSchema.parse(value);
  return value as SimulationWeekReport;
};

/** Legacy completion is explicit compatibility, never inferred from a future target. */
export const isStepComplete = (step: SimulationStep, simulation: Pick<SimulationRecord, "simNow" | "status" | "steps">): boolean =>
  step.state === undefined
    ? step.to > step.from && step.to <= simulation.simNow && !(simulation.status === "stepping" && simulation.steps.at(-1) === step)
    : step.state === "completed";

/** JSONB restores top-level step dates; report dates are decoded only when the report is read. */
export const readSimulationSteps = (value: unknown): SimulationStep[] => {
  const schema = z.array(z.object({
    kind: z.enum(["week", "day", "period"]), from: z.coerce.date(), to: z.coerce.date(),
    days: z.number().int().positive().optional(),
    input: z.array(z.object({ adId: z.string(), impressions: z.number(), clicks: z.number(), leads: z.number(), spendRub: z.number() })).optional(),
    recorded: z.boolean().optional(),
    state: z.enum(["pending", "running", "completed", "failed"]).optional(),
    completedAt: z.coerce.date().optional(), errorCode: z.string().optional(), report: z.string().optional(),
  }));
  const steps = schema.parse(value);
  for (const step of steps) {
    if (step.state === "completed" && (step.completedAt === undefined || (step.kind !== "day" && step.report === undefined))) {
      throw new Error("Completed simulation step has no saved result");
    }
    if (step.report !== undefined) readWeekReport(step.report);
  }
  return steps;
};
