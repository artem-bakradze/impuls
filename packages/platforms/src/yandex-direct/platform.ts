import { toLocalDate } from "@impuls/core";
import type { Kopecks, LocalDate } from "@impuls/core";
import { PlatformError } from "../contract";
import type {
  AdPatch,
  AdPlatform,
  CampaignPatch,
  ChangesResult,
  DailyStatRow,
  NewAd,
  NewCampaign,
  PlatformAd,
  PlatformCampaign,
  PlatformCapabilities,
} from "../contract";
import { DirectClient } from "./client";
import type { DirectLogger, DirectMode, JsonRecord } from "./client";
import {
  STRATEGY_AVERAGE_CPA,
  STRATEGY_WB_MAXIMUM_CLICKS,
  buildBiddingStrategy,
  buildSearchStrategy,
  buildSettings,
  buildStatsReportParams,
  parseAd,
  parseAverageCpaParams,
  parseCampaign,
  parseChangedCampaigns,
  parseStatsTsv,
  records,
  singleActionResult,
  toDirectTimestamp,
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
    { id: STRATEGY_WB_MAXIMUM_CLICKS, title: "Максимум кликов с недельным лимитом" },
    { id: STRATEGY_AVERAGE_CPA, title: "Оптимизация обращений по средней цене" },
  ],
  minWeeklyLimit: DIRECT_MIN_WEEKLY_LIMIT_KOPECKS,
};

/** Where a new ad goes. Ad groups (regions, keywords) and the landing URL are not part of `NewAd` yet. */
export interface AdTarget {
  adGroupId: string;
  href: string;
}

export interface YandexDirectPlatformOptions {
  mode: DirectMode;
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
   * Resolves the ad group and landing URL for `createAd`. Required for creating ads: Direct needs
   * `AdGroupId` and `Href`, which the platform contract does not carry. Without it `createAd` fails.
   */
  resolveAdTarget?: (campaignId: string) => Promise<AdTarget>;
  /**
   * Resolves Metrica goal and target CPA (ЦСО) when a campaign is created with or switched to
   * AVERAGE_CPA; the contract does not carry them. Without it such requests fail.
   */
  resolveAverageCpaParams?: (campaign: { id: string | null; name: string }) => Promise<AverageCpaParams>;
}

const CAMPAIGN_FIELDS = ["Id", "Name", "State", "Status"];
const TEXT_CAMPAIGN_FIELDS = ["BiddingStrategy", "Settings"];
const AD_FIELDS = ["Id", "CampaignId", "AdGroupId", "State", "Status", "StatusClarification"];
const TEXT_AD_FIELDS = ["Title", "Title2", "Text", "Href"];
/** Ads.get accepts at most 10 CampaignIds per request. */
const ADS_GET_CAMPAIGN_CHUNK = 10;
const ADS_GET_PAGE_LIMIT = 10_000;
const CAMPAIGNS_GET_CHUNK = 1_000;

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

/**
 * Yandex Direct API v5 adapter (design decisions 5, 9, 13, 15).
 * Reads (`get`, `checkCampaigns`, reports) are retried on transient errors; mutations are never retried here.
 */
export class YandexDirectPlatform implements AdPlatform {
  readonly client: DirectClient;
  private readonly now: () => Date;
  private readonly timeZone: string;

  constructor(private readonly options: YandexDirectPlatformOptions) {
    const now = options.now ?? (() => new Date());
    this.now = now;
    this.timeZone = options.timeZone ?? "Europe/Moscow";
    this.client = new DirectClient({
      mode: options.mode,
      token: options.token,
      logger: options.logger,
      clock: () => now().getTime(),
      ...(options.clientLogin !== undefined && { clientLogin: options.clientLogin }),
      ...(options.fetch !== undefined && { fetch: options.fetch }),
      ...(options.sleep !== undefined && { sleep: options.sleep }),
      ...(options.maxReportPolls !== undefined && { maxReportPolls: options.maxReportPolls }),
    });
  }

  capabilities(): PlatformCapabilities {
    return YANDEX_DIRECT_CAPABILITIES;
  }

  private async strategyInput(strategyId: string, weeklyLimit: Kopecks, campaign: { id: string | null; name: string }, current: AverageCpaParams | null): Promise<StrategyInput> {
    if (strategyId === STRATEGY_WB_MAXIMUM_CLICKS) {
      return { strategyId, weeklyLimit };
    }
    if (strategyId === STRATEGY_AVERAGE_CPA) {
      if (current) {
        return { strategyId, weeklyLimit, ...current };
      }
      if (!this.options.resolveAverageCpaParams) {
        throw new PlatformError("STRATEGY_PARAMS_REQUIRED", "AVERAGE_CPA needs a goal and target CPA; resolveAverageCpaParams is not configured", false);
      }
      return { strategyId, weeklyLimit, ...(await this.options.resolveAverageCpaParams(campaign)) };
    }
    throw new PlatformError("UNSUPPORTED_STRATEGY", `Strategy ${strategyId} is not in the Direct catalog`, false);
  }

  async createCampaign(input: NewCampaign): Promise<PlatformCampaign> {
    const strategy = await this.strategyInput(input.strategyId, input.weeklyLimit, { id: null, name: input.name }, null);
    const result = await this.client.call(
      "campaigns",
      "add",
      {
        Campaigns: [
          {
            Name: input.name,
            StartDate: toLocalDate(this.now(), this.timeZone),
            TextCampaign: { BiddingStrategy: buildBiddingStrategy(strategy), Settings: buildSettings(input.siteMonitoring) },
          },
        ],
      },
      false,
    );
    const id = singleActionResult(result, "AddResults");
    return this.getCampaign(id);
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
      const strategy = await this.strategyInput(strategyId, weeklyLimit, { id, name: current.name }, keepCpa);
      // VERIFY: Campaigns.update is assumed to accept BiddingStrategy with only the Search part.
      textCampaign.BiddingStrategy = { Search: buildSearchStrategy(strategy) };
    }
    if (patch.siteMonitoring !== undefined) {
      textCampaign.Settings = buildSettings(patch.siteMonitoring);
    }
    if (Object.keys(textCampaign).length > 0) {
      const result = await this.client.call("campaigns", "update", { Campaigns: [{ Id: directId, TextCampaign: textCampaign }] }, false);
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
    if (!this.options.resolveAdTarget) {
      throw new PlatformError("AD_TARGET_REQUIRED", "Creating a Direct ad needs an ad group and landing URL; resolveAdTarget is not configured", false);
    }
    const target = await this.options.resolveAdTarget(input.campaignId);
    const result = await this.client.call(
      "ads",
      "add",
      {
        Ads: [
          {
            AdGroupId: toDirectId(target.adGroupId),
            TextAd: { Title: input.title, Text: input.text, Href: target.href, Mobile: "NO" },
          },
        ],
      },
      false,
    );
    const id = singleActionResult(result, "AddResults");
    // New ads are drafts; the contract's "create" means "submit for showing", so send it to moderation.
    await this.moderateAd(id);
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
      if (raw?.Status === "DRAFT") {
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
