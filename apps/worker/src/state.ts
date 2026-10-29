import { addDays, classify, costPerLead, daysBetween, emptyStats, monthBudget, monthKey, resolveCso, toLocalDate } from "@impuls/core";
import type { EffectivenessClass, GuardState, Kopecks, LocalDate, PerformanceStats } from "@impuls/core";
import type { DailyStatRow, PlatformCapabilities } from "@impuls/platforms";
import type { Clock } from "./clock";
import type { AdRecord, BusinessRecord, DirectionRecord, Store } from "./store";

export const aggregate = (rows: readonly DailyStatRow[], key: (row: DailyStatRow) => string): Map<string, PerformanceStats> => {
  const result = new Map<string, PerformanceStats>();
  for (const row of rows) {
    const id = key(row);
    const current = result.get(id) ?? emptyStats();
    current.impressions += row.impressions;
    current.clicks += row.clicks;
    current.leads += row.leads;
    current.spend += row.spend;
    result.set(id, current);
  }
  return result;
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2) : (sorted[mid] ?? null);
};

export interface BusinessView {
  business: BusinessRecord;
  today: LocalDate;
  directions: DirectionRecord[];
  ads: AdRecord[];
  adStats14: Map<string, PerformanceStats>;
  directionStats14: Map<string, PerformanceStats>;
  spendLast7: Map<string, Kopecks>;
  adClasses: Map<string, EffectivenessClass>;
  directionClasses: Map<string, EffectivenessClass>;
  cso: Kopecks;
  monthBudget: Kopecks;
  spentMonth: Kopecks;
  guardState: GuardState;
}

/** Reads the current state of a business from the store: the basis for guards and the agent snapshot. */
export const loadBusinessView = async (
  store: Store,
  businessId: string,
  clock: Clock,
  capabilities: PlatformCapabilities,
): Promise<BusinessView> => {
  const business = await store.getBusiness(businessId);
  const today = toLocalDate(clock.now(), business.timeZone);
  const [directions, ads, decisions, experiments] = await Promise.all([
    store.directions(businessId),
    store.ads(businessId),
    store.userDecisions(businessId),
    store.experiments(businessId),
  ]);
  const adToDirection = new Map(ads.map((a) => [a.platformAdId, a]));
  const campaignToDirection = new Map(directions.map((d) => [d.platformCampaignId, d.id]));
  const rows30 = await store.stats(businessId, addDays(today, -29), today);
  const rows14 = rows30.filter((r) => r.date >= addDays(today, -13));
  const rows7 = rows30.filter((r) => r.date >= addDays(today, -6));
  const adStats14 = aggregate(rows14, (r) => adToDirection.get(r.adId)?.id ?? r.adId);
  const directionStats14 = aggregate(rows14, (r) => campaignToDirection.get(r.campaignId) ?? r.campaignId);
  const spendLast7 = new Map([...aggregate(rows7, (r) => campaignToDirection.get(r.campaignId) ?? r.campaignId)].map(([id, s]) => [id, s.spend]));
  const direction30 = aggregate(rows30, (r) => campaignToDirection.get(r.campaignId) ?? r.campaignId);
  const leads30 = [...direction30.values()].reduce((sum, s) => sum + s.leads, 0);
  const cpl30 = [...direction30.values()].map(costPerLead).filter((v): v is Kopecks => v !== null);
  const cso = resolveCso(business.csoSource, { leads: leads30, medianCostPerLead: median(cpl30) });
  const monthStart = `${monthKey(today)}-01`;
  const spentMonth = rows30.filter((r) => r.date >= monthStart).reduce((sum, r) => sum + r.spend, 0)
    + (monthStart < addDays(today, -29) ? (await store.stats(businessId, monthStart, addDays(today, -30))).reduce((s, r) => s + r.spend, 0) : 0);
  const budget = monthBudget(business.monthlyBudgetRub, business.launchedOn ?? today, today);
  const adClasses = new Map(
    ads.map((a) => [a.id, classify(adStats14.get(a.id) ?? emptyStats(), daysBetween(a.createdOn, today), cso)] as const),
  );
  const directionClasses = new Map(
    directions.map((d) => [d.id, classify(directionStats14.get(d.id) ?? emptyStats(), daysBetween(d.createdOn, today), cso)] as const),
  );
  return {
    business,
    today,
    directions,
    ads,
    adStats14,
    directionStats14,
    spendLast7,
    adClasses,
    directionClasses,
    cso,
    monthBudget: budget,
    spentMonth,
    guardState: {
      today,
      cso,
      monthBudget: budget,
      spentMonth,
      directions,
      ads,
      adClasses,
      directionStats14,
      userDecisions: decisions,
      strategyCatalog: capabilities.strategies.map((s) => s.id),
      leadGoalStrategies: capabilities.strategies.filter((s) => s.requiresLeadGoal).map((s) => s.id),
      hasLeadGoal: business.leadGoalId !== null,
      minWeeklyLimit: capabilities.minWeeklyLimit,
      activeExperiments: experiments.filter((e) => e.status === "running").length,
    },
  };
};
