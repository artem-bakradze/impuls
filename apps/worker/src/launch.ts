import { randomUUID } from "node:crypto";
import { firstImageSeed } from "@impuls/agent";
import { toLocalDate } from "@impuls/core";
import type { Channel } from "@impuls/core";
import { PlatformError } from "@impuls/platforms";
import type { AdPlatform } from "@impuls/platforms";
import { drawAdImages } from "./ad-images";
import { enqueueAgentEvent } from "./agent-turn";
import type { JobContext } from "./context";
import { NO_TRAFFIC_SETTINGS } from "./store";
import type { BusinessRecord } from "./store";

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
    /** `imageId`: the wizard's picture of a partner-site ad; a missing one is drawn at launch. */
    ads: { title: string; text: string; imageId?: string }[];
  }[];
}

export class LaunchError extends Error {
  constructor(readonly code: "ALREADY_LAUNCHED" | "EMPTY_PLAN" | "NO_KEYWORDS" | "IMAGE_UPLOAD_FAILED", message: string, options?: { cause: unknown }) {
    super(message, options);
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

/** The picture's name in the advertiser's library: the ad's title, which the owner recognizes in the Direct cabinet. */
const imageName = (title: string): string => title.trim().slice(0, 100);

export const IMAGE_UPLOAD_FAILED = "Яндекс не принял картинку объявления, поэтому реклама не запущена. Попробуйте ещё раз через несколько минут";

/**
 * Puts the picture of every partner-site ad into the platform's library before anything is created, so a refused
 * picture stops the launch whole and no ad goes out without its picture (platform-integration «Картинки в Директе»).
 */
const uploadPictures = async (ctx: JobContext, business: BusinessRecord, platform: AdPlatform, plan: LaunchPlan): Promise<Map<LaunchPlan["directions"][number]["ads"][number], { imageId: string; hash: string }>> => {
  const uploaded = new Map<LaunchPlan["directions"][number]["ads"][number], { imageId: string; hash: string }>();
  for (const direction of plan.directions) {
    if (direction.channel !== "network") continue;
    for (const ad of direction.ads) {
      const own = ad.imageId === undefined ? null : await ctx.store.adImage(ad.imageId);
      let image = own !== null && own.businessId === business.id ? own : null;
      if (image === null) {
        // A draft from before the pictures, or an id that is not this business's: the ad gets its own picture now.
        const facts = { category: business.card.category, services: business.card.services.map((s) => s.name), area: plan.city, adTitle: ad.title };
        const [drawn] = await drawAdImages(ctx, business.id, [{ facts, seed: firstImageSeed(ad.title) }]);
        image = drawn === undefined ? null : await ctx.store.adImage(drawn.imageId);
        if (image === null) throw new Error(`The picture of ad «${ad.title}» was not saved`);
      }
      try {
        uploaded.set(ad, { imageId: image.id, hash: await platform.uploadImage(image.png, imageName(ad.title)) });
      } catch (error) {
        if (error instanceof PlatformError) {
          throw new LaunchError("IMAGE_UPLOAD_FAILED", IMAGE_UPLOAD_FAILED, { cause: error });
        }
        throw error;
      }
    }
  }
  return uploaded;
};

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
  const pictures = await uploadPictures(ctx, business, platform, plan);
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
      city: plan.city,
      keywords: [...direction.keywords],
      ...NO_TRAFFIC_SETTINGS,
      negativeKeywords: [...direction.negativeKeywords],
    });
    for (const ad of direction.ads) {
      const picture = pictures.get(ad);
      const created = await platform.createAd({ campaignId: campaign.id, title: ad.title, text: ad.text, landingUrl: plan.landingUrl, ...(picture !== undefined && { imageHash: picture.hash }) });
      await ctx.store.saveAd({
        id: `ad-${randomUUID()}`,
        directionId: id,
        status: created.status,
        title: created.title,
        text: created.text,
        createdOn: today,
        platformAdId: created.id,
        moderation: created.moderation,
        imageId: picture?.imageId ?? null,
        imageHash: created.imageHash,
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
