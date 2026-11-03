import "server-only";
import type { LocalDate } from "@impuls/core";
import { feedDays } from "../insights-model";
import type { InsightFeedModel, TruthOf } from "../insights-model";
import { buildExperiments } from "./experiments";
import { buildHistory } from "./history";
import { store } from "./runtime";

/** The insight feed (insights spec «Лента инсайтов»): the running check and the day reviews from `since`. */
export const buildInsightFeed = async (businessId: string, options: { since: LocalDate | null; truthOf?: TruthOf }): Promise<InsightFeedModel> => {
  const s = store();
  const [business, insights, turns, history, experiments, hypotheses] = await Promise.all([
    s.getBusiness(businessId),
    s.insights(businessId),
    s.turnDigests(businessId),
    buildHistory(businessId),
    buildExperiments(businessId),
    s.hypotheses(businessId),
  ]);
  const running = experiments.running[0];
  return {
    timeZone: business.timeZone,
    check: running ? { item: running, minDays: experiments.minDays, maxDays: experiments.maxDays, minClicks: experiments.minClicks } : null,
    days: feedDays({
      insights,
      turns,
      timeZone: business.timeZone,
      launchedOn: business.launchedOn,
      since: options.since,
      entries: new Map(history.items.map((i) => [i.id, i])),
      hypotheses,
      ...(options.truthOf !== undefined && { truthOf: options.truthOf }),
    }),
    names: history.names,
  };
};
