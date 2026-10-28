import { addDays, allowedWeeklyTotal, budgetSignal, fitLimits, monthKey, safetyNet, toLocalDate } from "@impuls/core";
import type { Command, EffectivenessClass, Kopecks } from "@impuls/core";
import type { JobContext } from "./context";
import { adSnapshot, directionSnapshot } from "./executor";
import { runAgentTurn } from "./agent-turn";
import { loadBusinessView } from "./state";
import { renderTemplate } from "./templates";
import type { TemplateFacts } from "./templates";

export const HEARTBEAT_BUDGET_GUARD = "budget_guard";
export const HEARTBEAT_RECONCILIATION = "reconciliation";
export const HEARTBEAT_DISPATCHER = "dispatcher";

/** Hourly: stats for the last 7 days (covers today's refresh and the daily re-download). */
export const syncStats = async (ctx: JobContext, businessId: string, from?: string): Promise<void> => {
  const business = await ctx.store.getBusiness(businessId);
  const today = toLocalDate(ctx.clock.now(), business.timeZone);
  const directions = await ctx.store.directions(businessId);
  if (directions.length === 0) {
    return;
  }
  const rows = await ctx.platformFor(businessId).getStats(
    directions.map((d) => d.platformCampaignId),
    from ?? addDays(today, -7),
    today,
  );
  await ctx.store.upsertStats(businessId, rows);
};

const exec = (ctx: JobContext, businessId: string, command: Command, actor: "budget_guard" | "safety_net", reasonCode: string, facts: TemplateFacts) =>
  ctx.executor.execute({ businessId, command, actor, reasonCode, explanation: renderTemplate(reasonCode, facts) });

/** Hourly reconciliation with the ad cabinet via the Changes service (design decision 15). */
export const reconcile = async (ctx: JobContext, businessId: string): Promise<void> => {
  const platform = ctx.platformFor(businessId);
  const directions = await ctx.store.directions(businessId);
  if (directions.length === 0) {
    await ctx.store.beat(HEARTBEAT_RECONCILIATION, ctx.clock.now());
    return;
  }
  const since = (await ctx.store.getCursor(businessId, "changes")) ?? new Date(0);
  const result = await platform.checkChanges(directions.map((d) => d.platformCampaignId), since);
  const catalog = platform.capabilities().strategies.map((s) => s.id);
  for (const change of result.campaigns) {
    const direction = directions.find((d) => d.platformCampaignId === change.campaignId);
    if (!direction) {
      continue;
    }
    if (change.areas.includes("STAT")) {
      await syncStats(ctx, businessId, addDays(toLocalDate(ctx.clock.now(), (await ctx.store.getBusiness(businessId)).timeZone), -30));
    }
    if (change.areas.includes("SELF")) {
      const [campaign] = await platform.getCampaigns([direction.platformCampaignId]);
      if (campaign) {
        const before = directionSnapshot(direction);
        const after = directionSnapshot(campaign);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          const accepted = { ...direction, status: campaign.status, weeklyLimit: campaign.weeklyLimit, strategyId: campaign.strategyId };
          await ctx.store.saveDirection(accepted);
          await ctx.store.appendChange({
            businessId,
            actor: "reconciliation",
            author: "cabinet",
            action: { type: "ExternalChange" },
            objectKind: "direction",
            objectId: direction.id,
            before,
            after,
            status: "applied",
            reasonCode: "CABINET_CHANGE",
            explanation: renderTemplate("CABINET_CHANGE", { what: `настройки направления «${direction.name}»` }),
            turnId: null,
            createdAt: ctx.clock.now(),
            error: null,
          });
          if (!catalog.includes(campaign.strategyId)) {
            await exec(ctx, businessId, { type: "SetStrategy", directionId: direction.id, strategyId: direction.strategyId }, "budget_guard", "CABINET_STRATEGY_RESTORE", { name: direction.name });
          }
          if (campaign.status === "active") {
            const view = await loadBusinessView(ctx.store, businessId, ctx.clock, platform.capabilities());
            const others = view.directions.filter((d) => d.status === "active" && d.id !== direction.id).reduce((s, d) => s + d.weeklyLimit, 0);
            const room = allowedWeeklyTotal(view.spentMonth, view.monthBudget, view.today) - others;
            if (campaign.weeklyLimit > room) {
              const limit = Math.max(0, room);
              const command: Command =
                limit < platform.capabilities().minWeeklyLimit
                  ? { type: "PauseDirection", directionId: direction.id }
                  : { type: "SetSpendLimit", directionId: direction.id, weeklyLimit: limit };
              await exec(ctx, businessId, command, "budget_guard", command.type === "PauseDirection" ? "BUDGET_PAUSE_SHORTAGE" : "CABINET_LIMIT_CLAMP", {
                raised: campaign.weeklyLimit,
                limit,
                name: direction.name,
              });
            }
          }
        }
      }
    }
    if (change.areas.includes("CHILDREN")) {
      const platformAds = await platform.getAds([direction.platformCampaignId]);
      for (const ad of (await ctx.store.ads(businessId)).filter((a) => a.directionId === direction.id)) {
        const actual = platformAds.find((p) => p.id === ad.platformAdId);
        if (!actual) {
          continue;
        }
        const before = adSnapshot(ad);
        const after = adSnapshot(actual);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          await ctx.store.saveAd({ ...ad, status: actual.status, title: actual.title, text: actual.text });
          await ctx.store.appendChange({
            businessId,
            actor: "reconciliation",
            author: "cabinet",
            action: { type: "ExternalChange" },
            objectKind: "ad",
            objectId: ad.id,
            before,
            after,
            status: "applied",
            reasonCode: "CABINET_CHANGE",
            explanation: renderTemplate("CABINET_CHANGE", {
              what: before.text !== after.text || before.title !== after.title ? `текст объявления «${ad.title}»` : `состояние объявления «${ad.title}»`,
            }),
            turnId: null,
            createdAt: ctx.clock.now(),
            error: null,
          });
        }
      }
    }
  }
  await ctx.store.setCursor(businessId, "changes", result.checkedAt);
  await ctx.store.beat(HEARTBEAT_RECONCILIATION, ctx.clock.now());
};

/** Hourly budget guard (design decision 6): thresholds, new month resume and fitting limits. */
export const budgetGuard = async (ctx: JobContext, businessId: string): Promise<void> => {
  const platform = ctx.platformFor(businessId);
  const view = await loadBusinessView(ctx.store, businessId, ctx.clock, platform.capabilities());
  const signal = budgetSignal(view.spentMonth, view.monthBudget);
  const pausedByBudget = view.directions.some((d) => d.pausedByBudget);
  const notified = await ctx.store.getCursor(businessId, `notify80:${monthKey(view.today)}`);

  if (signal === "stop" && view.directions.some((d) => d.status === "active")) {
    await exec(ctx, businessId, { type: "PauseAll" }, "budget_guard", "BUDGET_EXHAUSTED", {});
    await ctx.store.notify({ businessId, kind: "budget_95", message: renderTemplate("BUDGET_EXHAUSTED", {}), at: ctx.clock.now() });
  } else if (signal !== "stop" && pausedByBudget) {
    await exec(ctx, businessId, { type: "ResumeAll" }, "budget_guard", "BUDGET_NEW_MONTH", {});
  }
  if (signal === "notify" && notified === null) {
    const left = Math.floor((view.monthBudget - view.spentMonth) / 100);
    await ctx.store.notify({ businessId, kind: "budget_80", message: `Израсходовано 80% бюджета месяца. Осталось ${left} ₽.`, at: ctx.clock.now() });
    await ctx.store.setCursor(businessId, `notify80:${monthKey(view.today)}`, ctx.clock.now());
  }

  const fresh = await loadBusinessView(ctx.store, businessId, ctx.clock, platform.capabilities());
  const active = fresh.directions.filter((d) => d.status === "active");
  const allowed = allowedWeeklyTotal(fresh.spentMonth, fresh.monthBudget, fresh.today);
  const total = active.reduce((sum, d) => sum + d.weeklyLimit, 0);
  if (total > allowed) {
    const rank = (id: string): number => {
      const stats = fresh.directionStats14.get(id);
      return stats && stats.leads > 0 ? -stats.spend / stats.leads : Number.NEGATIVE_INFINITY;
    };
    const fitted = fitLimits(
      active.map((d) => ({ directionId: d.id, weeklyLimit: d.weeklyLimit, rank: rank(d.id) })),
      allowed,
      platform.capabilities().minWeeklyLimit,
    );
    for (const directionId of fitted.paused) {
      const direction = active.find((d) => d.id === directionId);
      await exec(ctx, businessId, { type: "PauseDirection", directionId }, "budget_guard", "BUDGET_PAUSE_SHORTAGE", { name: direction?.name ?? "" });
    }
    for (const [directionId, limit] of fitted.limits) {
      const direction = active.find((d) => d.id === directionId);
      if (direction && limit < direction.weeklyLimit) {
        await exec(ctx, businessId, { type: "SetSpendLimit", directionId, weeklyLimit: limit }, "budget_guard", "BUDGET_FIT", { name: direction.name, limit });
      }
    }
  }
  await ctx.store.beat(HEARTBEAT_BUDGET_GUARD, ctx.clock.now());
};

/** Daily at 06:00 local time: safety net for the previous evaluation, new evaluation, agent turn. */
export const dailyEvaluation = async (ctx: JobContext, businessId: string): Promise<void> => {
  const platform = ctx.platformFor(businessId);
  const previous = await ctx.store.lastEvaluation(businessId);
  const now = ctx.clock.now();
  if (previous && now.getTime() - previous.evaluatedAt.getTime() >= 23.5 * 3_600_000 && (await ctx.store.getFlag("automation_enabled", businessId))) {
    await runSafetyNet(ctx, businessId, previous.evaluatedAt, previous.directionClasses, previous.borderlineSince);
  }
  const view = await loadBusinessView(ctx.store, businessId, ctx.clock, platform.capabilities());
  const borderlineSince = new Map<string, string>();
  for (const [adId, cls] of view.adClasses) {
    if (cls === "borderline") {
      borderlineSince.set(adId, previous?.borderlineSince.get(adId) ?? view.today);
    }
  }
  await ctx.store.saveEvaluation({
    businessId,
    evaluatedAt: now,
    on: view.today,
    adClasses: view.adClasses,
    directionClasses: view.directionClasses,
    borderlineSince,
  });
  await runAgentTurn(ctx, businessId, { kind: "daily_review" });
};

const runSafetyNet = async (
  ctx: JobContext,
  businessId: string,
  evaluatedAt: Date,
  directionClasses: Map<string, EffectivenessClass>,
  borderlineSince: Map<string, string>,
): Promise<void> => {
  const platform = ctx.platformFor(businessId);
  const view = await loadBusinessView(ctx.store, businessId, ctx.clock, platform.capabilities());
  const touched = new Set(
    (await ctx.store.changes(businessId))
      .filter((c) => c.actor === "agent" && c.status === "applied" && c.createdAt >= evaluatedAt)
      .map((c) => c.objectId),
  );
  const leads14 = new Map([...view.directionStats14].map(([id, s]) => [id, s.leads]));
  const experiments = await ctx.store.experiments(businessId);
  const actions = safetyNet({
    state: view.guardState,
    directionClasses,
    touchedByAgent: touched,
    spendLast7Days: view.spendLast7,
    leads14,
    borderlineSince,
    adsInExperiments: new Set(experiments.filter((e) => e.status === "running").map((e) => e.adId)),
  });
  for (const action of actions) {
    if (action.kind === "request_replacement") {
      // Replacement creatives come from ad-creatives (task group 6); until then the last ad stays active.
      continue;
    }
    const command = action.command;
    const name = facetName(view, command);
    const stats = "adId" in command ? view.adStats14.get(command.adId) : "directionId" in command ? view.directionStats14.get(command.directionId) : undefined;
    const facts: TemplateFacts = {
      name,
      spend: stats?.spend ?? 0,
      leads: stats?.leads ?? 0,
      cso: view.cso,
      cpl: stats && stats.leads > 0 ? Math.round(stats.spend / stats.leads) : 0,
    };
    await exec(ctx, businessId, command, "safety_net", action.reasonCode, facts);
  }
};

const facetName = (view: Awaited<ReturnType<typeof loadBusinessView>>, command: Command): string => {
  if ("adId" in command) {
    return view.ads.find((a) => a.id === command.adId)?.title ?? "";
  }
  if ("directionId" in command) {
    return view.directions.find((d) => d.id === command.directionId)?.name ?? "";
  }
  return "";
};

/** Daily reconciliation of spend vs budget; overrun opens an incident (budget-guard spec). */
export const verifyBudget = async (ctx: JobContext, businessId: string): Promise<Kopecks> => {
  const view = await loadBusinessView(ctx.store, businessId, ctx.clock, ctx.platformFor(businessId).capabilities());
  if (view.spentMonth > view.monthBudget) {
    await ctx.store.openIncident({
      kind: "budget_overrun",
      businessId,
      message: `Spend ${view.spentMonth} exceeds month budget ${view.monthBudget}`,
      openedAt: ctx.clock.now(),
    });
  }
  return view.spentMonth;
};
