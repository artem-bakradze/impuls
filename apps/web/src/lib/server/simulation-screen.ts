import "server-only";
import { addDays, costPerLead, resolveCso, toLocalDate } from "@impuls/core";
import type { Kopecks, LocalDate, PerformanceStats } from "@impuls/core";
import type { HistoryItem, Names } from "../history-view";
import { buildDecisionScreen, scenarioTruth } from "../simulation-screen";
import type { DecisionScreenModel } from "../simulation-screen";
import { buildServiceWork } from "../service-work";
import type { ServiceWorkModel } from "../service-work";
import { livedWeeks } from "../week-story";
import { buildHistory } from "./history";
import { buildInsightFeed } from "./insights";
import { store } from "./runtime";

/** The ads and the journal of «Реклама» (analytics spec), with the simulation's comparison when there is one. */
export type AdsWork = ServiceWorkModel & {
  site: string;
  history: HistoryItem[];
  names: Names;
  /** Only in a simulation: the run without the service (simulation-mode «Контрольный прогон»). */
  sim: (Pick<DecisionScreenModel, "comparison" | "result" | "decisionDays" | "day" | "totalDays" | "scenarioTitle"> & { ended: boolean }) | null;
};

const median = (values: readonly number[]): Kopecks | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? null) : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
};

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/** Weeks of a business on Direct: seven days from the launch, the morning after them closing the week. */
const calendarWeeks = (startedOn: LocalDate, today: LocalDate): { week: number; from: LocalDate; reviewedOn: LocalDate }[] => {
  const weeks: { week: number; from: LocalDate; reviewedOn: LocalDate }[] = [];
  for (let from = startedOn, week = 1; from <= today; from = addDays(from, 7), week++) weeks.push({ week, from, reviewedOn: addDays(from, 7) });
  return weeks;
};

export const loadAdsWork = async (businessId: string): Promise<AdsWork> => {
  const s = store();
  const business = await s.getBusiness(businessId);
  const simulation = business.mode === "simulation" ? await s.getSimulation(businessId) : null;
  const [directions, ads, changes, history, hypotheses] = await Promise.all([s.directions(businessId), s.ads(businessId), s.changes(businessId), buildHistory(businessId), s.hypotheses(businessId)]);
  const goal = business.csoSource.kind === "user" ? business.csoSource.goal : business.csoSource.reference;
  const now = simulation?.simNow ?? new Date();
  const startedOn = simulation ? toLocalDate(simulation.startedAt, business.timeZone) : (business.launchedOn ?? toLocalDate(now, business.timeZone));
  const today = toLocalDate(now, business.timeZone);
  const observed = await s.stats(businessId, startedOn, today);
  // The scenario's truth exists only in a simulation: on Direct the journal has no «На самом деле».
  const truthOf = simulation ? scenarioTruth({ simulation, ads, goal }) : undefined;
  const feed = await buildInsightFeed(businessId, { since: null, ...(truthOf && { truthOf }) });

  // The goal per lead as the morning evaluation resolves it: 30 days up to yesterday.
  const byCampaign = new Map<string, PerformanceStats>();
  for (const r of observed.filter((row) => row.date >= addDays(today, -30) && row.date < today)) {
    const known = byCampaign.get(r.campaignId) ?? { impressions: 0, clicks: 0, leads: 0, spend: 0 };
    byCampaign.set(r.campaignId, { impressions: known.impressions + r.impressions, clicks: known.clicks + r.clicks, leads: known.leads + r.leads, spend: known.spend + r.spend });
  }
  const cso = resolveCso(business.csoSource, {
    leads: [...byCampaign.values()].reduce((sum, v) => sum + v.leads, 0),
    medianCostPerLead: median([...byCampaign.values()].map(costPerLead).filter((v): v is Kopecks => v !== null)),
  });
  const check = feed.check?.item;
  const work = buildServiceWork({
    ads,
    directions,
    stats: observed,
    today,
    startedOn,
    timeZone: business.timeZone,
    cso,
    reviews: feed.days,
    history: history.items,
    changes,
    ...(check && { checkAds: [check.control, ...(check.variant ? [check.variant] : [])] }),
    openChecks: hypotheses.filter((h) => h.status === "checking"),
    weeks: simulation ? livedWeeks(simulation, business.timeZone) : calendarWeeks(startedOn, today),
  });
  // Presentation only: an ad without the owner's site leads to the mini-site, whose address is not the ad's concern here.
  const site = (business.card.siteUrl ? hostOf(business.card.siteUrl) : null) ?? "ваш сайт";
  let sim: AdsWork["sim"] = null;
  if (simulation) {
    const m = buildDecisionScreen({ observed, simulation, timeZone: business.timeZone, monthlyBudgetRub: business.monthlyBudgetRub, directions, changes });
    sim = { comparison: m.comparison, result: m.result, decisionDays: m.decisionDays, day: m.day, totalDays: m.totalDays, scenarioTitle: m.scenarioTitle, ended: m.result !== null };
  }
  return { ...work, site, history: history.items, names: history.names, sim };
};
