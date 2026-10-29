import { toLocalDate } from "@impuls/core";
import type { Kopecks, LocalDate } from "@impuls/core";
import { PlatformError } from "../contract";
import type {
  AdPatch,
  AdPlatform,
  CampaignPatch,
  ChangesResult,
  DailyStatRow,
  LeadGoal,
  NewAd,
  NewCampaign,
  PlatformAd,
  PlatformCampaign,
  PlatformCapabilities,
} from "../contract";
import { DirectClient } from "./client";
import type { DirectLogger, DirectRequestGuard, JsonRecord } from "./client";
import {
  AUTOTARGETING_KEYWORD,
  STRATEGY_AVERAGE_CPA,
  STRATEGY_WB_MAXIMUM_CLICKS,
  buildBiddingStrategy,
  buildSettings,
  buildStatsReportParams,
  buildTimeTargeting,
  parseAd,
  parseAverageCpaParams,
  parseCampaign,
  parseChangedCampaigns,
  parseStatsTsv,
  records,
  servingChannel,
  singleActionResult,
  toDirectTimestamp,
  withUtm,
} from "./mapping";
import type { AverageCpaParams, StrategyInput } from "./mapping";

/**
 * Minimum weekly spend limit for RUB accounts.
 * VERIFY: Direct docs say the minimum depends on currency and is returned by `Dictionaries.get`
 * (Currencies → MinimumWeeklySpendLimit); 300 ₽ is the commonly documented RUB value.
 */
export const DIRECT_MIN_WEEKLY_LIMIT_KOPECKS: Kopecks = 30_000;

export const YANDEX_DIRECT_CAPABILITIES: PlatformCapabilities = {
  platform: "yandex-direct",
  strategies: [
    { id: STRATEGY_WB_MAXIMUM_CLICKS, title: "Максимум кликов с недельным лимитом", requiresLeadGoal: false },
    { id: STRATEGY_AVERAGE_CPA, title: "Оптимизация обращений по средней цене", requiresLeadGoal: true },
  ],
  minWeeklyLimit: DIRECT_MIN_WEEKLY_LIMIT_KOPECKS,
};

export interface YandexDirectPlatformOptions {
  token: string;
  clientLogin?: string;
  fetch?: typeof fetch;
  logger: DirectLogger;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxReportPolls?: number;
  /** Account time zone used for the campaign `StartDate`. Documented default: Europe/Moscow. */
  timeZone?: string;
  /**
   * Whether `createAd` and text edits send ads to moderation. The service always does; contract tests never do,
   * so their campaigns stay unserved drafts (testing-harness spec).
   */
  submitAdsForModeration: boolean;
  guard?: DirectRequestGuard;
}

const CAMPAIGN_FIELDS = ["Id", "Name", "State", "Status"];
const TEXT_CAMPAIGN_FIELDS = ["BiddingStrategy", "Settings"];
const AD_FIELDS = ["Id", "CampaignId", "AdGroupId", "State", "Status", "StatusClarification"];
const TEXT_AD_FIELDS = ["Title", "Title2", "Text", "Href"];
/** Ads.get accepts at most 10 CampaignIds per request. */
const ADS_GET_CAMPAIGN_CHUNK = 10;
const ADS_GET_PAGE_LIMIT = 10_000;
const CAMPAIGNS_GET_CHUNK = 1_000;
/** Keywords.add accepts at most 1 000 phrases per request. */
const KEYWORDS_ADD_CHUNK = 1_000;

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

const toDirectId = (id: string): number => {
  const value = Number(id);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PlatformError("INVALID_ID", `Invalid Direct object id: ${id}`, false);
  }
  return value;
};

const needsLeadGoal = (strategyId: string): boolean =>
  YANDEX_DIRECT_CAPABILITIES.strategies.some((s) => s.id === strategyId && s.requiresLeadGoal);

const fromLeadGoal = (goal: LeadGoal): AverageCpaParams => ({ averageCpa: goal.targetCostPerLead, goalId: toDirectId(goal.goalId) });

/**
 * Yandex Direct API v5 adapter (design decisions 5, 9, 13, 15; replace-direct-sandbox decision 5).
 * One campaign per direction with exactly one ad group. Reads (`get`, `checkCampaigns`, reports) are retried on
 * transient errors; mutations are never retried here.
 */
export class YandexDirectPlatform implements AdPlatform {
  readonly client: DirectClient;
  private readonly now: () => Date;
  private readonly timeZone: string;
  private cityRegions: Promise<Map<string, number>> | null = null;

  constructor(private readonly options: YandexDirectPlatformOptions) {
    const now = options.now ?? (() => new Date());
    this.now = now;
    this.timeZone = options.timeZone ?? "Europe/Moscow";
    this.client = new DirectClient({
      token: options.token,
      logger: options.logger,
      clock: () => now().getTime(),
      ...(options.clientLogin !== undefined && { clientLogin: options.clientLogin }),
      ...(options.fetch !== undefined && { fetch: options.fetch }),
      ...(options.sleep !== undefined && { sleep: options.sleep }),
      ...(options.maxReportPolls !== undefined && { maxReportPolls: options.maxReportPolls }),
      ...(options.guard !== undefined && { guard: options.guard }),
    });
  }

  capabilities(): PlatformCapabilities {
    return YANDEX_DIRECT_CAPABILITIES;
  }

  private strategyInput(strategyId: string, weeklyLimit: Kopecks, leadGoal: LeadGoal | undefined, current: AverageCpaParams | null): StrategyInput {
    if (strategyId === STRATEGY_WB_MAXIMUM_CLICKS) {
      return { strategyId, weeklyLimit };
    }
    if (strategyId === STRATEGY_AVERAGE_CPA) {
      const params = leadGoal ? fromLeadGoal(leadGoal) : current;
      if (!params) {
        throw new PlatformError("LEAD_GOAL_REQUIRED", "AVERAGE_CPA needs a Metrica goal and a target cost per lead", false);
      }
      return { strategyId, weeklyLimit, ...params };
    }
    throw new PlatformError("UNSUPPORTED_STRATEGY", `Strategy ${strategyId} is not in the Direct catalog`, false);
  }

  /**
   * Direct region id of a city from the `GeoRegions` dictionary (loaded once per adapter instance).
   * API v5 targets ad groups by region only; there is no radius (replace-direct-sandbox decision 6).
   */
  async regionIdOf(city: string): Promise<number> {
    this.cityRegions ??= this.client
      .call("dictionaries", "get", { DictionaryNames: ["GeoRegions"] }, true)
      .then((result) => {
        const byName = new Map<string, number>();
        for (const region of records(result.GeoRegions)) {
          if (region.GeoRegionType === "City" && typeof region.GeoRegionName === "string" && typeof region.GeoRegionId === "number") {
            byName.set(region.GeoRegionName.toLowerCase(), region.GeoRegionId);
          }
        }
        return byName;
      })
      .catch((error: unknown) => {
        this.cityRegions = null;
        throw error;
      });
    const id = (await this.cityRegions).get(city.trim().toLowerCase());
    if (id === undefined) {
      throw new PlatformError("UNKNOWN_CITY", `Direct has no city region named ${city}`, false);
    }
    return id;
  }

  async createCampaign(input: NewCampaign): Promise<PlatformCampaign> {
    if (input.channel === "search" && input.targeting.keywords.length === 0) {
      throw new PlatformError("KEYWORDS_REQUIRED", "A search campaign needs at least one keyword", false);
    }
    if (needsLeadGoal(input.strategyId) && !input.leadGoal) {
      throw new PlatformError("LEAD_GOAL_REQUIRED", `${input.strategyId} needs a lead goal`, false);
    }
    const strategy = this.strategyInput(input.strategyId, input.weeklyLimit, input.leadGoal, null);
    const timeTargeting = buildTimeTargeting(input.schedule);
    const regionId = await this.regionIdOf(input.targeting.city);
    const result = await this.client.call(
      "campaigns",
      "add",
      {
        Campaigns: [
          {
            Name: input.name,
            StartDate: toLocalDate(this.now(), this.timeZone),
            TimeTargeting: timeTargeting,
            TextCampaign: { BiddingStrategy: buildBiddingStrategy(input.channel, strategy), Settings: buildSettings(input.siteMonitoring) },
          },
        ],
      },
      false,
    );
    const id = singleActionResult(result, "AddResults");
    const group = await this.client.call(
      "adgroups",
      "add",
      {
        AdGroups: [
          {
            Name: input.name,
            CampaignId: toDirectId(id),
            RegionIds: [regionId],
            ...(input.targeting.negativeKeywords.length > 0 && { NegativeKeywords: { Items: [...input.targeting.negativeKeywords] } }),
          },
        ],
      },
      false,
    );
    const adGroupId = toDirectId(singleActionResult(group, "AddResults"));
    const phrases = input.targeting.keywords.length > 0 ? input.targeting.keywords : [AUTOTARGETING_KEYWORD];
    for (const part of chunk(phrases, KEYWORDS_ADD_CHUNK)) {
      const added = await this.client.call("keywords", "add", { Keywords: part.map((Keyword) => ({ AdGroupId: adGroupId, Keyword })) }, false);
      const results = records(added.AddResults);
      if (results.length !== part.length) {
        throw new PlatformError("DIRECT_INVALID_RESPONSE", `Keywords.add returned ${results.length} results for ${part.length} phrases`, false);
      }
      for (const item of results) {
        singleActionResult({ AddResults: [item] }, "AddResults");
      }
    }
    return this.getCampaign(id);
  }

  /** The single ad group of a service campaign. */
  private async adGroupOf(campaignId: string): Promise<number> {
    const result = await this.client.call("adgroups", "get", { SelectionCriteria: { CampaignIds: [toDirectId(campaignId)] }, FieldNames: ["Id"] }, true);
    const groups = records(result.AdGroups);
    const id = groups[0]?.Id;
    if (groups.length !== 1 || typeof id !== "number") {
      throw new PlatformError("DIRECT_INVALID_RESPONSE", `Campaign ${campaignId} must have exactly one ad group, found ${groups.length}`, false);
    }
    return id;
  }

  private async getRawCampaigns(ids: readonly string[]): Promise<JsonRecord[]> {
    const all: JsonRecord[] = [];
    for (const part of chunk(ids, CAMPAIGNS_GET_CHUNK)) {
      const result = await this.client.call(
        "campaigns",
        "get",
        { SelectionCriteria: { Ids: part.map(toDirectId) }, FieldNames: CAMPAIGN_FIELDS, TextCampaignFieldNames: TEXT_CAMPAIGN_FIELDS },
        true,
      );
      all.push(...records(result.Campaigns));
    }
    return all;
  }

  private async getRawCampaign(id: string): Promise<JsonRecord> {
    const raw = (await this.getRawCampaigns([id]))[0];
    if (!raw) {
      throw new PlatformError("NOT_FOUND", `Campaign ${id} not found`, false);
    }
    return raw;
  }

  private async getCampaign(id: string): Promise<PlatformCampaign> {
    return parseCampaign(await this.getRawCampaign(id));
  }

  async getCampaigns(ids: readonly string[]): Promise<PlatformCampaign[]> {
    if (ids.length === 0) {
      return [];
    }
    const byId = new Map((await this.getRawCampaigns(ids)).map((raw) => {
      const campaign = parseCampaign(raw);
      return [campaign.id, campaign] as const;
    }));
    return ids.map((id) => {
      const campaign = byId.get(id);
      if (!campaign) {
        throw new PlatformError("NOT_FOUND", `Campaign ${id} not found`, false);
      }
      return campaign;
    });
  }

  async updateCampaign(id: string, patch: CampaignPatch): Promise<PlatformCampaign> {
    const directId = toDirectId(id);
    const textCampaign: JsonRecord = {};
    if (patch.weeklyLimit !== undefined || patch.strategyId !== undefined) {
      const raw = await this.getRawCampaign(id);
      const current = parseCampaign(raw);
      const strategyId = patch.strategyId ?? current.strategyId;
      const weeklyLimit = patch.weeklyLimit ?? current.weeklyLimit;
      if (!Number.isFinite(weeklyLimit)) {
        throw new PlatformError("WEEKLY_LIMIT_REQUIRED", `Campaign ${id} has no weekly limit; pass one explicitly`, false);
      }
      const keepCpa = strategyId === STRATEGY_AVERAGE_CPA && current.strategyId === STRATEGY_AVERAGE_CPA ? parseAverageCpaParams(raw) : null;
      const strategy = this.strategyInput(strategyId, weeklyLimit, patch.leadGoal, keepCpa);
      textCampaign.BiddingStrategy = buildBiddingStrategy(servingChannel(raw), strategy);
    }
    if (patch.siteMonitoring !== undefined) {
      textCampaign.Settings = buildSettings(patch.siteMonitoring);
    }
    // geoRadiusKm is kept by the service only: Direct targets ad groups by region (replace-direct-sandbox decision 6).
    const timeTargeting = patch.schedule !== undefined ? buildTimeTargeting(patch.schedule) : null;
    if (Object.keys(textCampaign).length > 0 || timeTargeting) {
      const item: JsonRecord = { Id: directId };
      if (Object.keys(textCampaign).length > 0) {
        item.TextCampaign = textCampaign;
      }
      if (timeTargeting) {
        item.TimeTargeting = timeTargeting;
      }
      const result = await this.client.call("campaigns", "update", { Campaigns: [item] }, false);
      singleActionResult(result, "UpdateResults");
    }
    if (patch.status !== undefined) {
      const method = patch.status === "paused" ? "suspend" : "resume";
      const result = await this.client.call("campaigns", method, { SelectionCriteria: { Ids: [directId] } }, false);
      singleActionResult(result, patch.status === "paused" ? "SuspendResults" : "ResumeResults");
    }
    return this.getCampaign(id);
  }

  async createAd(input: NewAd): Promise<PlatformAd> {
    const href = withUtm(input.landingUrl);
    const adGroupId = await this.adGroupOf(input.campaignId);
    const result = await this.client.call(
      "ads",
      "add",
      { Ads: [{ AdGroupId: adGroupId, TextAd: { Title: input.title, Text: input.text, Href: href, Mobile: "NO" } }] },
      false,
    );
    const id = singleActionResult(result, "AddResults");
    // New ads are drafts; the contract's "create" means "submit for showing", so send it to moderation.
    if (this.options.submitAdsForModeration) {
      await this.moderateAd(id);
    }
    return this.getAd(id);
  }

  private async moderateAd(id: string): Promise<void> {
    const result = await this.client.call("ads", "moderate", { SelectionCriteria: { Ids: [toDirectId(id)] } }, false);
    singleActionResult(result, "ModerateResults");
  }

  private async fetchAds(selection: JsonRecord): Promise<JsonRecord[]> {
    const all: JsonRecord[] = [];
    for (let offset = 0; ; ) {
      const result = await this.client.call(
        "ads",
        "get",
        {
          SelectionCriteria: { ...selection, Types: ["TEXT_AD"] },
          FieldNames: AD_FIELDS,
          TextAdFieldNames: TEXT_AD_FIELDS,
          Page: { Limit: ADS_GET_PAGE_LIMIT, Offset: offset },
        },
        true,
      );
      all.push(...records(result.Ads));
      if (typeof result.LimitedBy !== "number") {
        return all;
      }
      offset = result.LimitedBy;
    }
  }

  private async getAd(id: string): Promise<PlatformAd> {
    const raw = (await this.fetchAds({ Ids: [toDirectId(id)] }))[0];
    if (!raw) {
      throw new PlatformError("NOT_FOUND", `Ad ${id} not found`, false);
    }
    return parseAd(raw);
  }

  async getAds(campaignIds: readonly string[]): Promise<PlatformAd[]> {
    const ads: PlatformAd[] = [];
    for (const part of chunk(campaignIds, ADS_GET_CAMPAIGN_CHUNK)) {
      ads.push(...(await this.fetchAds({ CampaignIds: part.map(toDirectId) })).map(parseAd));
    }
    return ads;
  }

  async updateAd(id: string, patch: AdPatch): Promise<PlatformAd> {
    const directId = toDirectId(id);
    const textAd: JsonRecord = {};
    if (patch.title !== undefined) {
      textAd.Title = patch.title;
    }
    if (patch.text !== undefined) {
      textAd.Text = patch.text;
    }
    if (Object.keys(textAd).length > 0) {
      const result = await this.client.call("ads", "update", { Ads: [{ Id: directId, TextAd: textAd }] }, false);
      singleActionResult(result, "UpdateResults");
      // VERIFY: an edited accepted ad is assumed to go to moderation by itself; a draft needs `moderate`.
      const raw = (await this.fetchAds({ Ids: [directId] }))[0];
      if (raw?.Status === "DRAFT" && this.options.submitAdsForModeration) {
        await this.moderateAd(id);
      }
    }
    if (patch.status !== undefined) {
      const method = patch.status === "paused" ? "suspend" : "resume";
      const result = await this.client.call("ads", method, { SelectionCriteria: { Ids: [directId] } }, false);
      singleActionResult(result, patch.status === "paused" ? "SuspendResults" : "ResumeResults");
    }
    return this.getAd(id);
  }

  async checkChanges(campaignIds: readonly string[], since: Date): Promise<ChangesResult> {
    const result = await this.client.call("changes", "checkCampaigns", { Timestamp: toDirectTimestamp(since) }, true);
    const checkedAt = new Date(typeof result.Timestamp === "string" ? result.Timestamp : Number.NaN);
    if (Number.isNaN(checkedAt.getTime())) {
      throw new PlatformError("DIRECT_INVALID_RESPONSE", "Changes.checkCampaigns returned no Timestamp", false);
    }
    return { checkedAt, campaigns: parseChangedCampaigns(result, campaignIds) };
  }

  async getStats(campaignIds: readonly string[], from: LocalDate, to: LocalDate): Promise<DailyStatRow[]> {
    if (campaignIds.length === 0) {
      return [];
    }
    return parseStatsTsv(await this.client.report(buildStatsReportParams(campaignIds, from, to)));
  }

  /**
   * Direct API v5 has no method for the account balance: it is only available via the legacy
   * v4 Live `AccountManagement` method (shared account). Deliberately not implemented here.
   */
  getBalance(): Promise<Kopecks> {
    return Promise.reject(new PlatformError("NOT_SUPPORTED", "Direct API v5 does not expose the account balance", false));
  }
}
