import "server-only";
import { addDays, costPerLead, resolveCso } from "@impuls/core";
import type { Kopecks, PerformanceStats } from "@impuls/core";
import { buildDecisionScreen, scenarioTruth } from "../simulation-screen";
import type { DecisionScreen } from "../simulation-screen";
import { buildWeekStory, livedWeeks } from "../week-story";
import type { WeekStoryModel } from "../week-story";
import { buildHistory } from "./history";
import { buildInsightFeed } from "./insights";
import { store } from "./runtime";

const median = (values: readonly number[]): Kopecks | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? null) : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
};

/**
 * «Как сервис принимает решения» of a simulated business, with the story of a lived week — the given one, or the
 * newest; null for a business working with Direct.
 */
export const loadDecisionScreen = async (businessId: string, week: number | null = null): Promise<(DecisionScreen & { story: WeekStoryModel | null }) | null> => {
  const s = store();
  const simulation = await s.getSimulation(businessId);
  if (simulation === null) {
    return null;
  }
  const business = await s.getBusiness(businessId);
  const [directions, ads, changes, history] = await Promise.all([s.directions(businessId), s.ads(businessId), s.changes(businessId), buildHistory(businessId)]);
  const goal = business.csoSource.kind === "user" ? business.csoSource.goal : business.csoSource.reference;
  const model = buildDecisionScreen({ simulation, timeZone: business.timeZone, monthlyBudgetRub: business.monthlyBudgetRub, directions, changes });
  const truthOf = scenarioTruth({ simulation, ads, goal });
  // The whole run: the screen is the story of the simulation.
  const feed = await buildInsightFeed(businessId, { since: null, truthOf });

  const weeks = livedWeeks(simulation, business.timeZone);
  const window = weeks.find((w) => w.week === week) ?? weeks.at(-1);
  let story: WeekStoryModel | null = null;
  if (window !== undefined) {
    // 30 days up to the week's end: the goal per lead as the evaluation after the week resolved it.
    const stats = await s.stats(businessId, addDays(window.to, -29), window.to);
    const byCampaign = new Map<string, PerformanceStats>();
    for (const r of stats) {
      const known = byCampaign.get(r.campaignId) ?? { impressions: 0, clicks: 0, leads: 0, spend: 0 };
      byCampaign.set(r.campaignId, { impressions: known.impressions + r.impressions, clicks: known.clicks + r.clicks, leads: known.leads + r.leads, spend: known.spend + r.spend });
    }
    const leads30 = [...byCampaign.values()].reduce((sum, v) => sum + v.leads, 0);
    const cso = resolveCso(business.csoSource, { leads: leads30, medianCostPerLead: median([...byCampaign.values()].map(costPerLead).filter((v): v is Kopecks => v !== null)) });
    story = buildWeekStory({
      simulation,
      week: window.week,
      timeZone: business.timeZone,
      directions,
      ads,
      stats: stats.filter((r) => r.date >= addDays(window.to, -13)),
      cso,
      truthOf,
      reviews: feed.days,
      history: history.items,
      changes,
      comparison: model.comparison,
    });
  }
  return { ...model, feed, story };
};
