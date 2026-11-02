import { addDays, allowedWeeklyTotal, budgetSignal, evaluationFindings, fitLimits, monthKey, safetyNet, toLocalDate, turnReasons } from "@impuls/core";
import type { Command, EffectivenessClass, Kopecks } from "@impuls/core";
import { ADJUSTABLE_DEVICES, trafficSnapshot } from "./analyst";
import type { JobContext } from "./context";
import { adSnapshot, directionSnapshot } from "./executor";
import { businessLockKey } from "./locks";
import { agentBudgetSpent, findingsSeenByLastTurn, runAgentTurn } from "./agent-turn";
import { QUIET_DAY_CODE } from "./change-kinds";
import { isRuleInsightCode, saveQuietDay, saveRuleInsight, saveRulesDay } from "./insights";
import { prepareExperiment } from "./experiments";
import { aggregate, loadBusinessView } from "./state";
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

/** A rule's command; an applied decision of a rule gets its insight (insights spec «Инсайты страховочных правил»). */
const exec = async (ctx: JobContext, businessId: string, command: Command, actor: "budget_guard" | "safety_net", reasonCode: string, facts: TemplateFacts) => {
  const result = await ctx.executor.execute({ businessId, command, actor, reasonCode, explanation: renderTemplate(reasonCode, facts) });
  if (isRuleInsightCode(reasonCode) && (result.status === "applied" || result.status === "clamped")) {
    await saveRuleInsight(ctx, businessId, reasonCode, command, result, String(facts.name ?? ""));
  }
  return result;
};

/** Sync cursor of the one-time fill of negative phrases and adjustments for directions launched before they were kept. */
const TRAFFIC_CURSOR = "traffic";

/**
 * Negative phrases and bid adjustments changed in the cabinet (platform-integration spec «Разрезы статистики,
 * минус-фразы и корректировки в Директе»): the direction takes the platform's values, the history gets a cabinet entry,
 * and a changed adjustment counts as changed today, so the agent leaves it alone for a while. Under the business lock
 * and on a fresh record, so a command running at the same time does not lose its change.
 */
const reconcileTraffic = (ctx: JobContext, businessId: string, directionId: string): Promise<void> =>
  ctx.locks.withLock(businessLockKey(businessId), async () => {
    const direction = (await ctx.store.directions(businessId)).find((d) => d.id === directionId);
    if (!direction) {
      return;
    }
    const [settings] = await ctx.platformFor(businessId).getTrafficSettings([direction.platformCampaignId]);
    if (!settings) {
      return;
    }
    const before = trafficSnapshot(direction);
    const after = trafficSnapshot(settings);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return;
    }
    const today = toLocalDate(ctx.clock.now(), (await ctx.store.getBusiness(businessId)).timeZone);
    const changedDevices = ADJUSTABLE_DEVICES.filter((d) => direction.deviceAdjustments[d] !== settings.deviceAdjustments[d]);
    await ctx.store.saveDirection({
      ...direction,
      negativeKeywords: [...settings.negativeKeywords],
      deviceAdjustments: { ...settings.deviceAdjustments },
      deviceAdjustedOn: { ...direction.deviceAdjustedOn, ...Object.fromEntries(changedDevices.map((d) => [d, today])) },
    });
    const what = [
      ...(before.negativeKeywords === after.negativeKeywords ? [] : ["минус-фразы"]),
      ...(changedDevices.length === 0 ? [] : ["цена перехода по устройствам"]),
    ].join(" и ");
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
      explanation: renderTemplate("CABINET_CHANGE", { what: `${what} направления «${direction.name}»` }),
      turnId: null,
      createdAt: ctx.clock.now(),
      error: null,
      revertedById: null,
      outcome: null,
    });
  });

/** Hourly reconciliation with the ad cabinet via the Changes service (design decision 15). */
export const reconcile = async (ctx: JobContext, businessId: string): Promise<void> => {
  const platform = ctx.platformFor(businessId);
  const directions = await ctx.store.directions(businessId);
  if (directions.length === 0) {
    await ctx.store.beat(HEARTBEAT_RECONCILIATION, ctx.clock.now());
    return;
  }
  // Directions launched before the service kept these settings take them silently once: it is not a cabinet change.
  // Only these fields change, on records read under the business lock, so a running command keeps its change.
  if ((await ctx.store.getCursor(businessId, TRAFFIC_CURSOR)) === null) {
    await ctx.locks.withLock(businessLockKey(businessId), async () => {
      const settings = await platform.getTrafficSettings(directions.map((d) => d.platformCampaignId));
      for (const direction of await ctx.store.directions(businessId)) {
        const current = settings.find((s) => s.campaignId === direction.platformCampaignId);
        if (current) {
          await ctx.store.saveDirection({ ...direction, negativeKeywords: [...current.negativeKeywords], deviceAdjustments: { ...current.deviceAdjustments } });
        }
      }
      await ctx.store.setCursor(businessId, TRAFFIC_CURSOR, ctx.clock.now());
    });
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
            revertedById: null,
            outcome: null,
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
    if (change.areas.includes("SELF")) {
      await reconcileTraffic(ctx, businessId, direction.id);
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
            revertedById: null,
            outcome: null,
          });
        }
      }
    }
  }
  await ctx.store.setCursor(businessId, "changes", result.checkedAt);
  await ctx.store.beat(HEARTBEAT_RECONCILIATION, ctx.clock.now());
};

/**
 * First budget-guard hour of a month: limits cut for the end of the previous month go back up to what the new month
 * allows, keeping their proportions (budget-guard spec «Защита на стороне площадки»). Only raises; the fit after it
 * still lowers whatever does not fit.
 */
const spreadNewMonth = async (ctx: JobContext, businessId: string, minWeeklyLimit: number): Promise<void> => {
  const platform = ctx.platformFor(businessId);
  const view = await loadBusinessView(ctx.store, businessId, ctx.clock, platform.capabilities());
  const last = await ctx.store.getCursor(businessId, "budget_month");
  await ctx.store.setCursor(businessId, "budget_month", ctx.clock.now());
  if (last === null || monthKey(toLocalDate(last, view.business.timeZone)) === monthKey(view.today)) {
    return;
  }
  const active = view.directions.filter((d) => d.status === "active");
  const total = active.reduce((sum, d) => sum + d.weeklyLimit, 0);
  const allowed = allowedWeeklyTotal(view.spentMonth, view.monthBudget, view.today);
  if (total === 0 || allowed <= total) {
    return;
  }
  for (const direction of active) {
    const limit = Math.max(minWeeklyLimit, Math.floor((allowed * direction.weeklyLimit) / total));
    if (limit > direction.weeklyLimit) {
      await exec(ctx, businessId, { type: "SetSpendLimit", directionId: direction.id, weeklyLimit: limit }, "budget_guard", "BUDGET_NEW_MONTH_LIMITS", { name: direction.name, limit });
    }
  }
};

/** Hourly budget guard (design decision 6): thresholds, new month resume and fitting limits. */
export const budgetGuard = async (ctx: JobContext, businessId: string): Promise<void> => {
  const platform = ctx.platformFor(businessId);
  const view = await loadBusinessView(ctx.store, businessId, ctx.clock, platform.capabilities());
  const signal = budgetSignal(view.spentMonth, view.monthBudget);
  const pausedByBudget = view.directions.filter((d) => d.pausedByBudget);
  // Resume only when every budget-paused direction fits at the platform minimum, otherwise the fit below would
  // pause them again in the same hour (e.g. a shortage at the end of the month waits for the 1st).
  const resumable = [...view.directions.filter((d) => d.status === "active"), ...pausedByBudget].map((d) => ({ directionId: d.id, weeklyLimit: d.weeklyLimit, rank: 0 }));
  const fits = fitLimits(resumable, allowedWeeklyTotal(view.spentMonth, view.monthBudget, view.today), platform.capabilities().minWeeklyLimit).paused.length === 0;

  if (signal === "stop" && view.directions.some((d) => d.status === "active")) {
    await exec(ctx, businessId, { type: "PauseAll" }, "budget_guard", "BUDGET_EXHAUSTED", {});
    await ctx.store.notify({ businessId, kind: "budget_95", message: renderTemplate("BUDGET_EXHAUSTED", {}), at: ctx.clock.now() });
  } else if (signal !== "stop" && pausedByBudget.length > 0 && fits) {
    await exec(ctx, businessId, { type: "ResumeAll" }, "budget_guard", "BUDGET_NEW_MONTH", {});
  }

  await spreadNewMonth(ctx, businessId, platform.capabilities().minWeeklyLimit);

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

/**
 * Whether a deciding agent had its chance since `since`: it completed a turn, or the day was quiet — no reasons, so it
 * had already seen every finding (add-agent-insights decision 5; weekly-simulation-triggered-agent decision 3).
 */
const agentHadChanceSince = async (ctx: JobContext, businessId: string, since: Date): Promise<boolean> => {
  if (!ctx.agent.decides) return false;
  if ((await ctx.store.turns(businessId)).some((t) => t.status === "completed" && t.startedAt >= since)) return true;
  return (await ctx.store.insights(businessId)).some((i) => i.reasonCode === QUIET_DAY_CODE && i.createdAt >= since);
};

/**
 * Daily at 06:00 local time: the rules' backup for what the agent left from the previous evaluation, a new
 * evaluation, its findings and — only when there are reasons — the agent's turn (ad-agent «Поводы для хода агента»).
 * A day without reasons is quiet: no model call, and the rules wait for the agent as after a turn. When the agent is
 * off, unavailable or out of its cost limit, the rules act on the new evaluation the same day (optimization-engine).
 */
export const dailyEvaluation = async (ctx: JobContext, businessId: string): Promise<void> => {
  const platform = ctx.platformFor(businessId);
  const previous = await ctx.store.lastEvaluation(businessId);
  const now = ctx.clock.now();
  const agentEnabled = await ctx.store.getFlag("agent_enabled", businessId);
  const automationEnabled = await ctx.store.getFlag("automation_enabled", businessId);
  if (automationEnabled && previous && now.getTime() - previous.evaluatedAt.getTime() >= 23.5 * 3_600_000 && (await agentHadChanceSince(ctx, businessId, previous.evaluatedAt))) {
    await runSafetyNet(ctx, businessId, previous.evaluatedAt, previous.directionClasses, previous.borderlineSince, true, previous.adClasses);
  }
  const view = await loadBusinessView(ctx.store, businessId, ctx.clock, platform.capabilities());
  const borderlineSince = new Map<string, string>();
  for (const [adId, cls] of view.adClasses) {
    if (cls === "borderline") {
      borderlineSince.set(adId, previous?.borderlineSince.get(adId) ?? view.today);
    }
  }
  const findings = await findingsOf(ctx, businessId, view, borderlineSince);
  await ctx.store.saveEvaluation({
    businessId,
    evaluatedAt: now,
    on: view.today,
    adClasses: view.adClasses,
    directionClasses: view.directionClasses,
    borderlineSince,
    findings,
  });
  // A runtime that decides nothing is no agent: its turns are not run and the rules decide (add-agent-insights).
  const withAgent = agentEnabled && ctx.agent.decides;
  const reasons = withAgent ? turnReasons(findings, new Set(previous?.findings ?? []), await findingsSeenByLastTurn(ctx, businessId)) : [];
  if (withAgent && reasons.length === 0 && !(await agentBudgetSpent(ctx, businessId))) {
    await saveQuietDay(ctx, businessId);
    return;
  }
  const outcome = withAgent
    ? await runAgentTurn(ctx, businessId, { kind: "daily_review", reasons: reasons.map((r) => ({ kind: r.kind, objectKind: r.objectKind, objectId: r.objectId })) })
    : null;
  if (automationEnabled && outcome?.status !== "completed") {
    await saveRulesDay(ctx, businessId, !withAgent ? "disabled" : outcome?.status === "skipped" && outcome.reason === "cost_limit" ? "cost_limit" : "unavailable");
    await runSafetyNet(ctx, businessId, now, view.directionClasses, borderlineSince, false);
  }
};

/** The morning evaluation's findings: classes, room for a raise, a week against the one before, check days. */
const findingsOf = async (
  ctx: JobContext,
  businessId: string,
  view: Awaited<ReturnType<typeof loadBusinessView>>,
  borderlineSince: Map<string, string>,
): Promise<string[]> => {
  const toDirection = new Map(view.directions.map((d) => [d.platformCampaignId, d.id]));
  // Full days only: the 7 days before today and the 7 before them.
  const rows = await ctx.store.stats(businessId, addDays(view.today, -14), addDays(view.today, -1));
  const byDirection = (from: string, to: string) =>
    aggregate(
      rows.filter((r) => r.date >= from && r.date <= to),
      (r) => toDirection.get(r.campaignId) ?? r.campaignId,
    );
  const experiments = await ctx.store.experiments(businessId);
  const hypotheses = await ctx.store.hypotheses(businessId);
  return evaluationFindings({
    state: view.guardState,
    directionClasses: view.directionClasses,
    borderlineSince,
    adsInExperiments: new Set(experiments.filter((e) => e.status === "running").map((e) => e.adId)),
    spendLast7Days: view.spendLast7,
    directionLast7: byDirection(addDays(view.today, -7), addDays(view.today, -1)),
    directionPrevious7: byDirection(addDays(view.today, -14), addDays(view.today, -8)),
    hypothesesDue: hypotheses.filter((h) => h.status === "checking" && h.checkOn <= view.today).map((h) => ({ id: h.id, checkOn: h.checkOn })),
  });
};

const runSafetyNet = async (
  ctx: JobContext,
  businessId: string,
  evaluatedAt: Date,
  directionClasses: Map<string, EffectivenessClass>,
  borderlineSince: Map<string, string>,
  agentActed: boolean,
  /** Ad classes of that evaluation: the rules pause only what the agent saw as ineffective and had 24 hours for. */
  seenAdClasses?: Map<string, EffectivenessClass>,
): Promise<void> => {
  const platform = ctx.platformFor(businessId);
  const view = await loadBusinessView(ctx.store, businessId, ctx.clock, platform.capabilities());
  const adClasses =
    seenAdClasses === undefined
      ? view.guardState.adClasses
      : new Map([...view.guardState.adClasses].map(([id, cls]): [string, EffectivenessClass] => [id, cls === "ineffective" && seenAdClasses.get(id) !== "ineffective" ? "learning" : cls]));
  const touched = new Set(
    (await ctx.store.changes(businessId))
      // Resuming does not count as handling the problem, so it never postpones the safety net.
      .filter((c) => c.actor === "agent" && c.status === "applied" && c.createdAt >= evaluatedAt && !["ResumeAd", "ResumeDirection", "ResumeAll"].includes(c.action.type))
      .map((c) => c.objectId),
  );
  const leads14 = new Map([...view.directionStats14].map(([id, s]) => [id, s.leads]));
  const experiments = await ctx.store.experiments(businessId);
  const actions = safetyNet({
    state: { ...view.guardState, adClasses },
    directionClasses,
    touchedByAgent: touched,
    spendLast7Days: view.spendLast7,
    leads14,
    borderlineSince,
    adsInExperiments: new Set(experiments.filter((e) => e.status === "running").map((e) => e.adId)),
    agentActed,
  });
  for (const action of actions) {
    if (action.kind === "request_replacement") {
      // Replacement creatives come from ad-creatives (task group 6); until then the last ad stays active.
      continue;
    }
    const prepared = await prepareExperiment(ctx, businessId, action.command);
    if (!prepared.ok) {
      // No variant today (e.g. the text service is down); the rule tries again at the next evaluation.
      continue;
    }
    const command = prepared.command;
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
