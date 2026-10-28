import { costPerLead, daysInMonth, evaluateExperiment, goalAdvice, isUnderspending } from "@impuls/core";
import type { PerformanceStats } from "@impuls/core";
import { enqueueAgentEvent } from "./agent-turn";
import type { JobContext } from "./context";
import { aggregate, loadBusinessView } from "./state";

const GOAL_ADVICE_REPEAT_DAYS = 14;

const rub = (kopecks: number): string => `${Math.round(kopecks / 100).toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;

/**
 * «Цель важнее освоения бюджета» (optimization-engine spec): tells the owner when the goal is unreachable
 * and when the budget is underspent because of the goal. The goal itself never changes automatically.
 */
export const adviseOnGoal = async (ctx: JobContext, businessId: string): Promise<void> => {
  const view = await loadBusinessView(ctx.store, businessId, ctx.clock, ctx.platformFor(businessId).capabilities());
  const pastLearning = view.directions.filter((d) => d.status === "active" && view.directionClasses.get(d.id) !== "learning");
  const notifications = await ctx.store.notifications(businessId);
  const recent = (kind: string) =>
    notifications.some((n) => n.kind === kind && ctx.clock.now().getTime() - n.at.getTime() < GOAL_ADVICE_REPEAT_DAYS * 86_400_000);

  if (pastLearning.length > 0 && !recent("goal_unreachable")) {
    const advice = goalAdvice(
      pastLearning.map((d) => costPerLead(view.directionStats14.get(d.id) ?? { impressions: 0, clicks: 0, leads: 0, spend: 0 })),
      view.cso,
    );
    if (advice.kind === "unreachable") {
      await ctx.store.notify({
        businessId,
        kind: "goal_unreachable",
        message:
          `Сейчас обращение стоит около ${rub(advice.medianCostPerLead)} — дороже вашей цели ${rub(view.cso)}. ` +
          `Можно поднять цель до ${rub(advice.suggestedGoal)} или оставить ${rub(view.cso)}: тогда я буду тратить меньше и оставлю только самое дешёвое`,
        at: ctx.clock.now(),
      });
    }
  }

  const day = Number(view.today.slice(8, 10));
  const remaining = daysInMonth(view.today) - day;
  const last7 = [...view.spendLast7.values()].reduce((sum, s) => sum + s, 0);
  const forecast = view.spentMonth + (last7 / 7) * remaining;
  const pausedForGoal = view.directions.some((d) => d.status === "paused" && view.directionClasses.get(d.id) === "ineffective");
  if (day >= 7 && pausedForGoal && isUnderspending(forecast, view.monthBudget) && !recent("underspend")) {
    await ctx.store.notify({
      businessId,
      kind: "underspend",
      message: "Тратим меньше бюджета, чтобы не платить за обращения дороже вашей цели",
      at: ctx.clock.now(),
    });
  }
};

/** Daily: decides running experiments with the deterministic rule and applies the result (ab-testing spec). */
export const evaluateExperiments = async (ctx: JobContext, businessId: string): Promise<number> => {
  const view = await loadBusinessView(ctx.store, businessId, ctx.clock, ctx.platformFor(businessId).capabilities());
  let finished = 0;
  for (const experiment of await ctx.store.experiments(businessId)) {
    if (experiment.status !== "running" || experiment.variantAdId === null) {
      continue;
    }
    const control = view.ads.find((a) => a.id === experiment.adId);
    const variant = view.ads.find((a) => a.id === experiment.variantAdId);
    if (!control || !variant) {
      continue;
    }
    const rows = await ctx.store.stats(businessId, experiment.startedOn, view.today);
    const byAd = aggregate(rows, (r) => r.adId);
    const empty: PerformanceStats = { impressions: 0, clicks: 0, leads: 0, spend: 0 };
    const controlStats = byAd.get(control.platformAdId) ?? empty;
    const variantStats = byAd.get(variant.platformAdId) ?? empty;
    const outcome = evaluateExperiment({ experimentId: experiment.id, startedOn: experiment.startedOn, today: view.today, control: controlStats, variant: variantStats });
    if (outcome.status === "running") {
      continue;
    }
    const keepVariant = outcome.status === "variant_wins" || (outcome.status === "no_difference" && outcome.keep === "variant");
    const [keep, drop] = keepVariant ? [variant, control] : [control, variant];
    const [keepStats, dropStats] = keepVariant ? [variantStats, controlStats] : [controlStats, variantStats];
    const keepCpl = costPerLead(keepStats);
    const dropCpl = costPerLead(dropStats);
    const cheaper = keepCpl !== null && dropCpl !== null && dropCpl > 0 ? Math.round((1 - keepCpl / dropCpl) * 100) : null;
    const numbers = `«${keep.title}»: ${keepStats.leads} обращений по ${keepCpl === null ? "—" : rub(keepCpl)}, «${drop.title}»: ${dropStats.leads} обращений по ${dropCpl === null ? "—" : rub(dropCpl)}`;
    const explanation =
      outcome.status === "no_difference"
        ? `За 3 недели разница оказалась слишком маленькой, чтобы на неё полагаться. Оставили «${keep.title}». ${numbers}.`
        : cheaper !== null
          ? `Вариант «${keep.title}» приводил клиентов на ${cheaper}% дешевле — оставили его. ${numbers}.`
          : `Вариант «${keep.title}» приводил клиентов дешевле — оставили его. ${numbers}.`;
    const result = await ctx.executor.execute({
      businessId,
      command: { type: "FinishExperiment", experimentId: experiment.id, directionId: experiment.directionId, keepAdId: keep.id, pauseAdId: drop.id },
      actor: "safety_net",
      reasonCode: `EXPERIMENT_${outcome.status.toUpperCase()}`,
      explanation,
    });
    if (result.status === "applied" || result.status === "clamped") {
      const updated = (await ctx.store.experiments(businessId)).find((e) => e.id === experiment.id);
      if (updated) {
        await ctx.store.saveExperiment({ ...updated, outcome: explanation });
      }
      await enqueueAgentEvent(ctx, businessId, { kind: "experiment_finished", experimentIds: [experiment.id] });
      finished++;
    }
  }
  return finished;
};
