import { randomUUID } from "node:crypto";
import { addDays, costPerLead, daysBetween, daysInMonth, emptyStats, factKey, factObjectRef, monthKey } from "@impuls/core";
import type { Command, InsightDraft, InsightFact, PerformanceStats } from "@impuls/core";
import type { DailyStatRow } from "@impuls/platforms";
import type { JobContext } from "./context";
import { DEVICE_WORDS } from "./analyst";
import { QUIET_DAY_CODE, RULES_DAY_CODE } from "./change-kinds";
import type { ExecutionResult } from "./executor";
import { aggregate, loadBusinessView } from "./state";
import type { BusinessView } from "./state";
import type { InsightRecord } from "./store";

const rub = (kopecks: number): number => Math.round(kopecks / 100);

/** «реклама в поиске» when a channel has one direction, else «реклама «Маникюр — Поиск»». */
export const directionLabel = (view: BusinessView, id: string): string => {
  const direction = view.directions.find((d) => d.id === id);
  if (!direction) return "реклама";
  const sameChannel = view.directions.filter((d) => d.channel === direction.channel).length;
  if (sameChannel > 1) return `реклама «${direction.name}»`;
  return direction.channel === "search" ? "реклама в поиске" : "реклама на сайтах-партнёрах";
};

/** «0%», «−25%», «+20%» */
export const signedPercent = (percent: number): string => (percent === 0 ? "0%" : `${percent > 0 ? "+" : "−"}${Math.abs(percent)}%`);

const adLabel = (view: BusinessView, id: string): string => `объявление «${view.ads.find((a) => a.id === id)?.title ?? ""}»`;

/**
 * The fact catalog of a business at this moment (insights spec «Факты проверяются по данным»): only aggregated
 * advertising statistics, the budget and the goal — the allowlist of the agent snapshot (ad-agent spec).
 */
export const factCatalog = (view: BusinessView, rows14: readonly DailyStatRow[]): InsightFact[] => {
  const facts: InsightFact[] = [];
  const add = (key: string, object: string, metric: InsightFact["metric"], period: InsightFact["period"], value: number, unit: InsightFact["unit"]) =>
    facts.push({ key, object, metric, period, value, unit });
  const last7 = rows14.filter((r) => r.date >= addDays(view.today, -6));
  const prev7 = rows14.filter((r) => r.date < addDays(view.today, -6));
  const byPlatformAd = new Map(view.ads.map((a) => [a.platformAdId, a.id]));
  const byCampaign = new Map(view.directions.map((d) => [d.platformCampaignId, d.id]));
  const adOf = (r: DailyStatRow) => byPlatformAd.get(r.adId) ?? r.adId;
  const directionOf = (r: DailyStatRow) => byCampaign.get(r.campaignId) ?? r.campaignId;

  const periodFacts = (
    keyOf: (metric: InsightFact["metric"], period: InsightFact["period"]) => string,
    object: string,
    s14: PerformanceStats,
    s7: PerformanceStats,
    p7: PerformanceStats,
  ) => {
    add(keyOf("spend", "14d"), object, "spend", "14d", rub(s14.spend), "rub");
    add(keyOf("leads", "14d"), object, "leads", "14d", s14.leads, "count");
    add(keyOf("impressions", "14d"), object, "impressions", "14d", s14.impressions, "count");
    add(keyOf("clicks", "14d"), object, "clicks", "14d", s14.clicks, "count");
    const cpl = costPerLead(s14);
    if (cpl !== null) add(keyOf("cost_per_lead", "14d"), object, "cost_per_lead", "14d", rub(cpl), "rub");
    add(keyOf("spend", "7d"), object, "spend", "7d", rub(s7.spend), "rub");
    add(keyOf("leads", "7d"), object, "leads", "7d", s7.leads, "count");
    add(keyOf("spend", "prev7d"), object, "spend", "prev7d", rub(p7.spend), "rub");
    add(keyOf("leads", "prev7d"), object, "leads", "prev7d", p7.leads, "count");
  };

  const ad7 = aggregate(last7, adOf);
  const adPrev = aggregate(prev7, adOf);
  for (const ad of view.ads) {
    periodFacts((m, p) => factKey.ad(ad.id, m, p), adLabel(view, ad.id), view.adStats14.get(ad.id) ?? emptyStats(), ad7.get(ad.id) ?? emptyStats(), adPrev.get(ad.id) ?? emptyStats());
  }
  const dir7 = aggregate(last7, directionOf);
  const dirPrev = aggregate(prev7, directionOf);
  for (const direction of view.directions) {
    const label = directionLabel(view, direction.id);
    periodFacts((m, p) => factKey.direction(direction.id, m, p), label, view.directionStats14.get(direction.id) ?? emptyStats(), dir7.get(direction.id) ?? emptyStats(), dirPrev.get(direction.id) ?? emptyStats());
    add(factKey.direction(direction.id, "weekly_limit", "now"), label, "weekly_limit", "now", rub(direction.weeklyLimit), "rub");
  }
  for (const channel of ["search", "network"] as const) {
    const ids = new Set(view.directions.filter((d) => d.channel === channel).map((d) => d.id));
    if (ids.size === 0) continue;
    const stats = aggregate(rows14.filter((r) => ids.has(directionOf(r))), () => channel).get(channel) ?? emptyStats();
    const object = channel === "search" ? "поиск Яндекса" : "сайты-партнёры Яндекса";
    add(factKey.channel(channel, "spend", "14d"), object, "spend", "14d", rub(stats.spend), "rub");
    add(factKey.channel(channel, "leads", "14d"), object, "leads", "14d", stats.leads, "count");
    const cpl = costPerLead(stats);
    if (cpl !== null) add(factKey.channel(channel, "cost_per_lead", "14d"), object, "cost_per_lead", "14d", rub(cpl), "rub");
  }
  const budget = budgetFigures(view);
  add(factKey.budget("budget"), "бюджет месяца", "budget", "month", budget.monthRub, "rub");
  add(factKey.budget("budget_spent"), "бюджет месяца", "budget_spent", "month", budget.spentRub, "rub");
  add(factKey.budget("budget_left"), "бюджет месяца", "budget_left", "month", budget.leftRub, "rub");
  add(factKey.budget("budget_pace"), "бюджет месяца", "budget_pace", "month", budget.evenPaceRub, "rub");
  add(factKey.goal(), "цель", "goal", "now", rub(view.cso), "rub");
  return facts;
};

/** The month budget, spent, left and the even pace by today (what an even spend would be by now). */
export const budgetFigures = (view: BusinessView): { monthRub: number; spentRub: number; leftRub: number; evenPaceRub: number } => {
  const monthStart = `${monthKey(view.today)}-01`;
  const launched = view.business.launchedOn ?? view.today;
  const from = launched > monthStart ? launched : monthStart;
  const total = daysInMonth(view.today) - Number(from.slice(8, 10)) + 1;
  const elapsed = daysBetween(from, view.today) + 1;
  const monthRub = rub(view.monthBudget);
  const spentRub = rub(view.spentMonth);
  return {
    monthRub,
    spentRub,
    // From the rounded figures, so that «осталось» is exactly «бюджет − потрачено» on the screen.
    leftRub: Math.max(0, monthRub - spentRub),
    evenPaceRub: rub(Math.floor((view.monthBudget * elapsed) / Math.max(1, total))),
  };
};

/** «Отключили объявление «Маникюр без записи»» — what was done, in the owner's words. */
export const actionText = (view: BusinessView, command: Command): string => {
  switch (command.type) {
    case "PauseAd":
      return `Отключили ${adLabel(view, command.adId)}`;
    case "ResumeAd":
      return `Включили ${adLabel(view, command.adId)}`;
    case "PauseDirection":
      return `Остановили: ${directionLabel(view, command.directionId)}`;
    case "ResumeDirection":
      return `Снова включили: ${directionLabel(view, command.directionId)}`;
    case "SetSpendLimit":
      return `Лимит: ${directionLabel(view, command.directionId)} — ${rub(command.weeklyLimit).toLocaleString("ru-RU").replace(/\s/g, " ")} ₽ в неделю`;
    case "SetStrategy":
      return `Сменили способ расхода денег: ${directionLabel(view, command.directionId)}`;
    case "UpdateSchedule":
      return `Изменили время показа: ${directionLabel(view, command.directionId)}`;
    case "UpdateAdText":
      return `Изменили текст: ${adLabel(view, command.adId)}`;
    case "StartExperiment":
      return `Начали проверку нового варианта: ${adLabel(view, command.adId)}`;
    case "FinishExperiment":
      return `Оставили лучший вариант: ${adLabel(view, command.keepAdId)}`;
    case "PauseAll":
      return "Остановили всю рекламу";
    case "ResumeAll":
      return "Снова включили рекламу";
    case "AddNegativeKeywords":
    case "RemoveNegativeKeywords": {
      const verb = command.type === "AddNegativeKeywords" ? "Добавили" : "Убрали";
      const what = command.phrases.length === 1 ? "минус-фразу" : "минус-фразы";
      return `${verb} ${what} ${command.phrases.map((p) => `«${p}»`).join(", ")}: ${directionLabel(view, command.directionId)}`;
    }
    case "SetDeviceAdjustment": {
      const before = view.directions.find((d) => d.id === command.directionId)?.deviceAdjustments[command.device] ?? 0;
      return `Цена перехода ${DEVICE_WORDS[command.device].from}: было ${signedPercent(before)} → стало ${signedPercent(command.percent)} (${directionLabel(view, command.directionId)})`;
    }
    default:
      return "Изменили рекламу";
  }
};

/**
 * «Что решили» from the executor's answer (insights spec): applied, clamped («урезано до 1 290 ₽ в неделю из-за остатка
 * бюджета» — the guard's message says it) or refused («отклонено: …»).
 */
const decisionOf = (view: BusinessView, command: Command, result: ExecutionResult): InsightRecord["decision"] => {
  const action = actionText(view, result.status === "applied" || result.status === "clamped" ? result.command : command);
  switch (result.status) {
    case "applied":
      return { kind: "action", text: action, status: "applied", changeIds: [result.entryId] };
    case "clamped":
      return { kind: "action", text: `${action} — ${result.message}`, status: "clamped", changeIds: [result.entryId] };
    default:
      return { kind: "action", text: `${action} — отклонено: ${result.message}`, status: "rejected", changeIds: [] };
  }
};

const objectRefOf = (command: Command | null, keys: readonly string[]): InsightRecord["objectRef"] => {
  if (command && "adId" in command) return { kind: "ad", id: command.adId };
  if (command && command.type === "FinishExperiment") return { kind: "ad", id: command.keepAdId };
  if (command && "directionId" in command) return { kind: "direction", id: command.directionId };
  for (const key of keys) {
    const ref = factObjectRef(key);
    if (ref) return ref;
  }
  return null;
};

/** Saves an insight and links the history entries of its decision to it. */
const saveInsight = async (ctx: JobContext, insight: InsightRecord): Promise<InsightRecord> => {
  await ctx.store.saveInsight(insight);
  for (const id of insight.decision.changeIds) {
    await ctx.store.updateChange(id, { insightId: insight.id });
  }
  return insight;
};

/** A refusal of the same change the owner has already seen is not shown again for this long. */
const REPEATED_REFUSAL_MS = 3 * 86_400_000;

/**
 * An agent's insight after its action (or without one), facts resolved from the turn's catalog. A guard's refusal
 * of the same change of the same object within 3 days is not a new insight: the owner has seen it, and the attempt
 * stays in the turn journal (an agent may retry a change every day while the month's budget has no room).
 */
export const saveAgentInsight = async (
  ctx: JobContext,
  input: { view: BusinessView; catalog: readonly InsightFact[]; turnId: string; draft: InsightDraft; command: Command | null; result: ExecutionResult | null },
): Promise<InsightRecord | null> => {
  const { view, catalog, draft, command, result } = input;
  const facts = draft.factKeys.map((key) => catalog.find((f) => f.key === key)).filter((f): f is InsightFact => f !== undefined);
  const decision: InsightRecord["decision"] =
    command !== null && result !== null ? decisionOf(view, command, result) : { kind: "none", text: draft.decision ?? "Пока ничего не меняем", status: "none", changeIds: [] };
  const objectRef = objectRefOf(command, draft.factKeys);
  if (decision.status === "rejected") {
    const since = ctx.clock.now().getTime() - REPEATED_REFUSAL_MS;
    const seen = (await ctx.store.insights(view.business.id)).some(
      (i) =>
        i.source === "agent" &&
        i.decision.status === "rejected" &&
        i.createdAt.getTime() >= since &&
        i.decision.text === decision.text &&
        i.objectRef?.kind === objectRef?.kind &&
        i.objectRef?.id === objectRef?.id,
    );
    if (seen) return null;
  }
  return saveInsight(ctx, {
    id: randomUUID(),
    businessId: view.business.id,
    turnId: input.turnId,
    source: "agent",
    reasonCode: draft.reasonCode,
    observation: draft.observation,
    facts,
    decision,
    next: draft.next,
    objectRef,
    createdAt: ctx.clock.now(),
  });
};

/** Reason codes of the rules that are shown as insights; budget-guard limit cuts are not (insights spec). */
const RULE_TEMPLATES: Record<string, (name: string) => { observation: string; next: string; facts: (keys: RuleKeys) => string[] }> = {
  SAFETY_PAUSE_AD: (name) => ({
    observation: `Объявление «${name}» тратит деньги, а клиенты из него обходятся дороже цели.`,
    next: "Через неделю проверим, стала ли реклама в целом приводить клиентов дешевле.",
    facts: (k) => [k.ad("spend", "14d"), k.ad("leads", "14d"), k.goal],
  }),
  SAFETY_PAUSE_DIRECTION: (name) => ({
    observation: `Реклама «${name}» целиком приводит клиентов слишком дорого.`,
    next: "Деньги перейдут рекламе, которая работает; через неделю сравним результат.",
    facts: (k) => [k.direction("spend", "14d"), k.direction("leads", "14d"), k.goal],
  }),
  SAFETY_SCALE_EFFECTIVE: (name) => ({
    observation: `Реклама «${name}» приводит клиентов дешевле цели и упирается в недельный лимит.`,
    next: "Через неделю проверим, выросло ли число обращений.",
    facts: (k) => [k.direction("cost_per_lead", "14d"), k.goal, k.direction("spend", "7d"), k.limit],
  }),
  SAFETY_REDISTRIBUTE_FREED: (name) => ({
    observation: `Деньги остановленной рекламы перешли туда, где клиенты дешевле: «${name}».`,
    next: "Через неделю проверим, выросло ли число обращений.",
    facts: (k) => [k.direction("cost_per_lead", "14d"), k.goal, k.limit],
  }),
  SAFETY_START_EXPERIMENT: (name) => ({
    observation: `Объявление «${name}» приводит клиентов примерно по цене цели — непонятно, оставлять ли его.`,
    next: "Проверка идёт не меньше 7 дней; оставим вариант, который приводит клиентов дешевле.",
    facts: (k) => [k.ad("spend", "14d"), k.ad("leads", "14d"), k.goal],
  }),
  BUDGET_PAUSE_SHORTAGE: () => ({
    observation: "Остатка бюджета на этот месяц хватает только на самую выгодную рекламу.",
    next: "С 1-го числа реклама снова включится с полным бюджетом.",
    facts: (k) => [k.budget("budget_left"), k.budget("budget"), k.direction("spend", "14d")],
  }),
  BUDGET_EXHAUSTED: () => ({
    observation: "Бюджет этого месяца почти израсходован.",
    next: "С 1-го числа реклама снова включится с полным бюджетом.",
    facts: (k) => [k.budget("budget_spent"), k.budget("budget")],
  }),
  BUDGET_NEW_MONTH: () => ({
    observation: "Начался новый месяц — бюджет снова полный.",
    next: "Реклама снова работает в пределах бюджета месяца.",
    facts: (k) => [k.budget("budget"), k.budget("budget_left")],
  }),
};

interface RuleKeys {
  ad: (metric: InsightFact["metric"], period: InsightFact["period"]) => string;
  direction: (metric: InsightFact["metric"], period: InsightFact["period"]) => string;
  budget: (metric: "budget" | "budget_spent" | "budget_left" | "budget_pace") => string;
  goal: string;
  limit: string;
}

export const isRuleInsightCode = (reasonCode: string): boolean => reasonCode in RULE_TEMPLATES;

/** The direction a command concerns (an ad's direction for ad commands). */
const directionOf = (view: BusinessView, command: Command): string => {
  if ("directionId" in command) return command.directionId;
  if ("adId" in command) return view.ads.find((a) => a.id === command.adId)?.directionId ?? "";
  return view.directions[0]?.id ?? "";
};

/**
 * A rule's insight from its template (insights spec «Инсайты страховочных правил»): the facts are the same numbers
 * the rule acted on, taken from the catalog at the moment of the decision.
 */
export const saveRuleInsight = async (ctx: JobContext, businessId: string, reasonCode: string, command: Command, result: ExecutionResult, name: string): Promise<InsightRecord | null> => {
  const template = RULE_TEMPLATES[reasonCode];
  if (!template) return null;
  const view = await loadBusinessView(ctx.store, businessId, ctx.clock, ctx.platformFor(businessId).capabilities());
  const catalog = factCatalog(view, await ctx.store.stats(businessId, addDays(view.today, -13), view.today));
  const adId = "adId" in command ? command.adId : "";
  const directionId = directionOf(view, command);
  const keys: RuleKeys = {
    ad: (m, p) => factKey.ad(adId, m, p),
    direction: (m, p) => factKey.direction(directionId, m, p),
    budget: (m) => factKey.budget(m),
    goal: factKey.goal(),
    limit: factKey.direction(directionId, "weekly_limit", "now"),
  };
  const filled = template(name);
  const facts = filled.facts(keys).map((key) => catalog.find((f) => f.key === key)).filter((f): f is InsightFact => f !== undefined);
  return saveInsight(ctx, {
    id: randomUUID(),
    businessId,
    turnId: null,
    source: "rule",
    reasonCode,
    observation: filled.observation,
    facts,
    decision: decisionOf(view, command, result),
    next: filled.next,
    objectRef: objectRefOf(command, []),
    createdAt: ctx.clock.now(),
  });
};

/** Why the rules decided alone today, in the owner's words (insights spec «Разбор дня»). */
export type RulesDayReason = "disabled" | "unavailable" | "cost_limit";

const RULES_DAY_REASONS: Record<RulesDayReason, string> = {
  disabled: "помощник выключен",
  unavailable: "помощник был недоступен",
  cost_limit: "лимит расходов на помощника исчерпан",
};

/** «Сегодня решения принимали страховочные правила: …» — a heading without facts, never shown without the rules' insights. */
export const saveRulesDay = async (ctx: JobContext, businessId: string, reason: RulesDayReason): Promise<void> => {
  await ctx.store.saveInsight({
    id: randomUUID(),
    businessId,
    turnId: null,
    source: "rule",
    reasonCode: RULES_DAY_CODE,
    observation: `Сегодня решения принимали страховочные правила: ${RULES_DAY_REASONS[reason]}`,
    facts: [],
    decision: { kind: "none", text: "", status: "none", changeIds: [] },
    next: "",
    objectRef: null,
    createdAt: ctx.clock.now(),
  });
};

/** A day without reasons for the agent's turn: «Посмотрели рекламу — менять ничего не нужно», with no model call. */
export const saveQuietDay = async (ctx: JobContext, businessId: string): Promise<void> => {
  await ctx.store.saveInsight({
    id: randomUUID(),
    businessId,
    turnId: null,
    source: "rule",
    reasonCode: QUIET_DAY_CODE,
    observation: "Посмотрели рекламу — менять ничего не нужно",
    facts: [],
    decision: { kind: "none", text: "", status: "none", changeIds: [] },
    next: "",
    objectRef: null,
    createdAt: ctx.clock.now(),
  });
};

/** The verdict of an A/B check as an insight: the numbers of both variants for the time of the check. */
export const saveExperimentInsight = async (
  ctx: JobContext,
  input: { businessId: string; reasonCode: string; explanation: string; command: Command; result: ExecutionResult; keep: { leads: number; spend: number }; drop: { leads: number; spend: number } },
): Promise<InsightRecord> => {
  const view = await loadBusinessView(ctx.store, input.businessId, ctx.clock, ctx.platformFor(input.businessId).capabilities());
  const side = (object: string, stats: { leads: number; spend: number }): InsightFact[] => {
    const facts: InsightFact[] = [{ key: `check:${object}:leads`, object, metric: "leads", period: "check", value: stats.leads, unit: "count" }];
    const cpl = stats.leads === 0 ? null : Math.round(stats.spend / stats.leads);
    facts.push(
      cpl === null
        ? { key: `check:${object}:spend`, object, metric: "spend", period: "check", value: rub(stats.spend), unit: "rub" }
        : { key: `check:${object}:cost_per_lead`, object, metric: "cost_per_lead", period: "check", value: rub(cpl), unit: "rub" },
    );
    return facts;
  };
  return saveInsight(ctx, {
    id: randomUUID(),
    businessId: input.businessId,
    turnId: null,
    source: "rule",
    reasonCode: input.reasonCode,
    observation: input.explanation,
    facts: [...side("оставленный вариант", input.keep), ...side("отключённый вариант", input.drop)],
    decision: decisionOf(view, input.command, input.result),
    next: "Следующую проверку начнём, когда появится объявление, которое работает на грани цели.",
    objectRef: objectRefOf(input.command, []),
    createdAt: ctx.clock.now(),
  });
};
