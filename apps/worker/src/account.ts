import type { JobContext } from "./context";

export const PERSONAL_DATA_RETENTION_DAYS = 30;

/**
 * Account deletion (auth spec): stop the service's campaigns, revoke OAuth tokens, switch the agent off,
 * delete agent notes and mark the owner deleted. Personal data is purged within 30 days by `purgeDeletedAccounts`.
 */
export const deleteAccount = async (ctx: JobContext, businessId: string): Promise<{ message: string }> => {
  const stop = await ctx.executor.execute({
    businessId,
    command: { type: "PauseAll" },
    actor: "user",
    reasonCode: "ACCOUNT_DELETED",
    explanation: "Вы удалили аккаунт — реклама остановлена.",
  });
  if (stop.status === "failed") {
    throw new Error(`Could not stop campaigns before deletion: ${stop.code}`);
  }
  const now = ctx.clock.now();
  await ctx.store.setFlag("agent_enabled", false, businessId);
  await ctx.store.setFlag("automation_enabled", false, businessId);
  await ctx.store.revokePlatformAccount(businessId, now);
  await ctx.store.saveNotes(businessId, []);
  await ctx.store.markOwnerDeleted(businessId, now);
  return { message: "Реклама остановлена, данные будут удалены" };
};

export const AGENT_JOURNAL_RETENTION_DAYS = 90;

/** Agent turn journal is kept for at least 90 days (ad-agent spec). */
export const purgeOldTurns = (ctx: JobContext): Promise<number> =>
  ctx.store.purgeTurns(new Date(ctx.clock.now().getTime() - AGENT_JOURNAL_RETENTION_DAYS * 86_400_000));

/** Daily: anonymizes owners whose deletion is older than the retention period. */
export const purgeDeletedAccounts = (ctx: JobContext): Promise<number> =>
  ctx.store.purgeDeletedOwners(new Date(ctx.clock.now().getTime() - PERSONAL_DATA_RETENTION_DAYS * 86_400_000));
