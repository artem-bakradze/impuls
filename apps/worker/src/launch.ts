import { randomUUID } from "node:crypto";
import { toLocalDate } from "@impuls/core";
import type { Channel } from "@impuls/core";
import { PlatformError } from "@impuls/platforms";
import { enqueueAgentEvent } from "./agent-turn";
import type { JobContext } from "./context";

export interface LaunchPlan {
  /** Landing page every ad leads to (the owner's site); the platform adapter adds UTM tags. */
  landingUrl: string;
  /** City of the business, the zone the campaigns are shown in (replace-direct-sandbox decision 6). */
  city: string;
  directions: {
    name: string;
    channel: Channel;
    weeklyLimitRub: number;
    /** Search phrases; required for the search channel. */
    keywords: string[];
    negativeKeywords: string[];
    ads: { title: string; text: string }[];
  }[];
}

export class LaunchError extends Error {
  constructor(readonly code: "ALREADY_LAUNCHED" | "EMPTY_PLAN" | "NO_KEYWORDS", message: string) {
    super(message);
  }
}

/**
 * «Запустить» from the launch wizard (business-onboarding spec): one campaign per «услуги × канал»
 * with site monitoring, ads sent to moderation, a history entry «Реклама запущена» and a launch turn for the agent.
 */
export type LaunchResult =
  | { status: "launched"; directionIds: string[] }
  /** Direct refused because advertiser data for ad marking is missing (platform-integration spec). */
  | { status: "needs_advertiser_data"; message: string };

export const launchAds = async (ctx: JobContext, businessId: string, plan: LaunchPlan): Promise<LaunchResult> => {
  const business = await ctx.store.getBusiness(businessId);
  if (business.launchedOn !== null) {
    throw new LaunchError("ALREADY_LAUNCHED", "Реклама уже запущена");
  }
  if (plan.directions.length === 0 || plan.directions.some((d) => d.ads.length === 0)) {
    throw new LaunchError("EMPTY_PLAN", "В каждом направлении нужно хотя бы одно объявление");
  }
  // Checked for the whole plan before anything is created (platform-integration spec).
  if (plan.directions.some((d) => d.channel === "search" && d.keywords.length === 0)) {
    throw new LaunchError("NO_KEYWORDS", "Не получилось подобрать поисковые запросы для этой услуги — уточните описание услуги");
  }
  const platform = ctx.platformFor(businessId);
  const today = toLocalDate(ctx.clock.now(), business.timeZone);
  const strategyId = platform.capabilities().strategies[0]?.id;
  if (strategyId === undefined) {
    throw new Error("Platform declares no strategies");
  }
  const directionIds: string[] = [];
  for (const direction of plan.directions) {
    let campaign;
    try {
      campaign = await platform.createCampaign({
        name: `[Импульс] ${direction.name}`,
        channel: direction.channel,
        weeklyLimit: direction.weeklyLimitRub * 100,
        strategyId,
        siteMonitoring: true,
        targeting: { city: plan.city, keywords: direction.keywords, negativeKeywords: direction.negativeKeywords },
        schedule: business.card.hours,
      });
    } catch (error) {
      if (error instanceof PlatformError && error.code === "ADVERTISER_DATA_REQUIRED" && directionIds.length === 0) {
        return { status: "needs_advertiser_data", message: "Яндексу нужны данные о вашем бизнесе для маркировки рекламы" };
      }
      throw error;
    }
    const id = `dir-${randomUUID()}`;
    await ctx.store.saveDirection({
      id,
      businessId,
      name: direction.name,
      channel: direction.channel,
      status: campaign.status,
      weeklyLimit: campaign.weeklyLimit,
      strategyId: campaign.strategyId,
      createdOn: today,
      lastLimitIncreaseOn: null,
      lastStrategyChangeOn: null,
      platformCampaignId: campaign.id,
      pausedByBudget: false,
      pausedByUser: false,
      schedule: business.card.hours,
      geoRadiusKm: 3,
    });
    for (const ad of direction.ads) {
      const created = await platform.createAd({ campaignId: campaign.id, title: ad.title, text: ad.text, landingUrl: plan.landingUrl });
      await ctx.store.saveAd({
        id: `ad-${randomUUID()}`,
        directionId: id,
        status: created.status,
        title: created.title,
        text: created.text,
        createdOn: today,
        platformAdId: created.id,
        moderation: created.moderation,
      });
    }
    directionIds.push(id);
  }
  await ctx.store.saveBusiness({ ...business, launchedOn: today });
  await ctx.store.appendChange({
    businessId,
    actor: "user",
    author: "user",
    action: { type: "ExternalChange" },
    objectKind: "business",
    objectId: businessId,
    before: { launched: false },
    after: { launched: true },
    status: "applied",
    reasonCode: "LAUNCH",
    explanation: "Реклама запущена. Яндекс проверяет объявления, обычно это занимает несколько часов.",
    turnId: null,
    createdAt: ctx.clock.now(),
    error: null,
    revertedById: null,
    outcome: null,
  });
  await enqueueAgentEvent(ctx, businessId, { kind: "launch" });
  return { status: "launched", directionIds };
};
