import { localHour, toLocalDate, weekStart } from "@impuls/core";
import { checkModerationAndBalance, reconcileStats } from "./analytics";
import { adviseOnGoal, evaluateExperiments } from "./optimization";
import type { JobContext } from "./context";
import { recordOutcomes } from "./history";
import { purgeDeletedAccounts } from "./account";
import { expireApprovals, processAgentInbox } from "./agent-turn";
import { budgetGuard, dailyEvaluation, HEARTBEAT_DISPATCHER, reconcile, syncStats, verifyBudget } from "./jobs";

export const DAILY_EVALUATION_HOUR = 6;

/**
 * Hourly dispatcher (design decision 2). Runs per-business jobs in a fixed order:
 * reconciliation first (also after downtime), then stats, budget guard, and the 06:00 local evaluation.
 */
export const dispatchHour = async (ctx: JobContext): Promise<void> => {
  const now = ctx.clock.now();
  for (const business of await ctx.store.listBusinesses()) {
    if (business.launchedOn === null) {
      continue;
    }
    await reconcile(ctx, business.id);
    await syncStats(ctx, business.id);
    await budgetGuard(ctx, business.id);
    await checkModerationAndBalance(ctx, business.id);
    await expireApprovals(ctx, business.id);
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
  }
  await ctx.executor.recoverPending(5 * 60_000);
  await purgeDeletedAccounts(ctx);
  await ctx.store.beat(HEARTBEAT_DISPATCHER, now);
};

/** Which businesses get their 06:00 job at this instant — used by tests and the production scheduler. */
export const businessesDueForDaily = (timeZones: readonly { id: string; timeZone: string }[], at: Date): string[] =>
  timeZones.filter((b) => localHour(at, b.timeZone) === DAILY_EVALUATION_HOUR).map((b) => b.id);
