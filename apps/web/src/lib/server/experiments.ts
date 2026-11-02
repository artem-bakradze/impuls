import "server-only";
import { AB_MAX_DAYS, AB_MIN_CLICKS, AB_MIN_DAYS, daysBetween, emptyStats, toLocalDate } from "@impuls/core";
import { aggregate } from "@impuls/worker";
import { businessClock } from "./read-context";
import type { ExperimentsModel } from "../experiments-model";
import { store } from "./runtime";

/** A/B checks with plain progress (ab-testing spec); the summary shows the running one as «Сейчас проверяем». */
export const buildExperiments = async (businessId: string): Promise<ExperimentsModel> => {
  const s = store();
  const [business, experiments, ads, directions] = await Promise.all([s.getBusiness(businessId), s.experiments(businessId), s.ads(businessId), s.directions(businessId)]);
  const today = toLocalDate((await businessClock(businessId)).now(), business.timeZone);
  const adById = new Map(ads.map((a) => [a.id, a]));
  const items = await Promise.all(
    experiments.map(async (e) => {
      const rows = await s.stats(businessId, e.startedOn, today);
      const byAd = aggregate(rows, (r) => r.adId);
      const variant = (adId: string | null) => {
        if (adId === null) return null;
        const ad = adById.get(adId);
        const stats = (ad ? byAd.get(ad.platformAdId) : undefined) ?? emptyStats();
        return { title: ad?.title ?? "Объявление", text: ad?.text ?? "", clicks: stats.clicks, leads: stats.leads, spend: stats.spend, active: ad?.status === "active" };
      };
      return {
        id: e.id,
        hypothesis: e.hypothesis,
        direction: directions.find((d) => d.id === e.directionId)?.name ?? "",
        startedOn: e.startedOn,
        day: daysBetween(e.startedOn, today) + 1,
        status: e.status,
        outcome: e.outcome,
        control: variant(e.adId) ?? { title: "Объявление", text: "", clicks: 0, leads: 0, spend: 0, active: false },
        variant: variant(e.variantAdId),
      };
    }),
  );
  return {
    minDays: AB_MIN_DAYS,
    maxDays: AB_MAX_DAYS,
    minClicks: AB_MIN_CLICKS,
    running: items.filter((i) => i.status === "running"),
    finished: items.filter((i) => i.status === "finished").reverse(),
  };
};
