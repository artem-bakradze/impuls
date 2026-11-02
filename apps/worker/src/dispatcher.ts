import { localHour, toLocalDate, weekStart } from "@impuls/core";
import { checkModerationAndBalance, reconcileStats } from "./analytics";
import { adviseOnGoal, evaluateExperiments } from "./optimization";
import type { JobContext } from "./context";
import type { BusinessRecord } from "./store";
import { recordOutcomes } from "./history";
import { purgeDeletedAccounts, purgeOldTurns } from "./account";
import { processAgentInbox, runAgentTurn } from "./agent-turn";
import { budgetGuard, dailyEvaluation, HEARTBEAT_DISPATCHER, reconcile, syncStats, verifyBudget } from "./jobs";

export const DAILY_EVALUATION_HOUR = 6;
/** Monday's weekly review, after the day's evaluation (add-agent-analyst-stage1 decision 7). */
export const WEEKLY_REVIEW_HOUR = 7;

/**
 * One hour of a launched business, in a fixed order: reconciliation first (also after downtime), then stats, budget
 * guard, and the 06:00 local evaluation. The hourly dispatcher runs it for Direct businesses, the simulation ticker
 * for simulated ones on their virtual clock (add-simulation-mode decision 4).
 */
export const runBusinessHour = async (ctx: JobContext, business: BusinessRecord): Promise<void> => {
  const now = ctx.clock.now();
  await reconcile(ctx, business.id);
  await syncStats(ctx, business.id);
  await budgetGuard(ctx, business.id);
  await checkModerationAndBalance(ctx, business.id);
  await processAgentInbox(ctx, business.id);
  if (localHour(now, business.timeZone) === DAILY_EVALUATION_HOUR) {
    await verifyBudget(ctx, business.id);
    await evaluateExperiments(ctx, business.id);
    await dailyEvaluation(ctx, business.id);
    await adviseOnGoal(ctx, business.id);
    await recordOutcomes(ctx, business.id);
    if (weekStart(toLocalDate(now, business.timeZone)) === toLocalDate(now, business.timeZone)) {
      await reconcileStats(ctx, business.id);
    }
  }
  // A runtime that decides nothing has no review to make; the turn checks the switch and the spend limit itself.
  const monday = weekStart(toLocalDate(now, business.timeZone)) === toLocalDate(now, business.timeZone);
  if (monday && localHour(now, business.timeZone) === WEEKLY_REVIEW_HOUR && ctx.agent.decides) {
    await runAgentTurn(ctx, business.id, { kind: "weekly_review" });
  }
};

/** Hourly dispatcher (design decision 2): every launched Direct business; simulated ones have their own clock. */
export const dispatchHour = async (ctx: JobContext): Promise<void> => {
  const now = ctx.clock.now();
  const businesses = await ctx.store.listBusinesses();
  for (const business of businesses) {
    if (business.launchedOn === null || business.mode === "simulation") {
      continue;
    }
    await runBusinessHour(ctx, business);
  }
  const simulated = new Set(businesses.filter((b) => b.mode === "simulation").map((b) => b.id));
  await ctx.executor.recoverPending(5 * 60_000, (businessId) => !simulated.has(businessId));
  await purgeDeletedAccounts(ctx);
  await purgeOldTurns(ctx);
  await ctx.store.beat(HEARTBEAT_DISPATCHER, now);
};

/** Which businesses get their 06:00 job at this instant — used by tests and the production scheduler. */
export const businessesDueForDaily = (timeZones: readonly { id: string; timeZone: string }[], at: Date): string[] =>
  timeZones.filter((b) => localHour(at, b.timeZone) === DAILY_EVALUATION_HOUR).map((b) => b.id);
