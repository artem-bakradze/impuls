import { PlatformError, YANDEX_DIRECT_CAPABILITIES, YandexDirectPlatform } from "@impuls/platforms";
import type {
  AdPatch,
  AdPlatform,
  BreakdownDimension,
  BreakdownRow,
  CampaignPatch,
  ChangesResult,
  DailyStatRow,
  DirectRequestLogEntry,
  NewAd,
  NewCampaign,
  PlatformAd,
  PlatformCampaign,
  PlatformCapabilities,
  TrafficSettings,
} from "@impuls/platforms";
import type { Kopecks, LocalDate } from "@impuls/core";

/** Decrypted access token of the business's connected Direct account, or null when none is connected. */
export type DirectTokenSource = (businessId: string) => Promise<string | null>;

/**
 * The real Direct platform of one business (DIRECT_API_MODE=production). `platformFor` must be synchronous,
 * so the token is loaded on the first call and kept for the lifetime of this object (one job).
 */
export class BusinessDirectPlatform implements AdPlatform {
  private inner: Promise<YandexDirectPlatform> | null = null;

  constructor(
    private readonly businessId: string,
    private readonly tokens: DirectTokenSource,
    private readonly log: (entry: DirectRequestLogEntry & { businessId: string }) => void,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  private platform(): Promise<YandexDirectPlatform> {
    this.inner ??= this.tokens(this.businessId).then((token) => {
      if (token === null) {
        throw new PlatformError("DIRECT_NOT_CONNECTED", `Business ${this.businessId} has no connected Direct account`, false);
      }
      return new YandexDirectPlatform({
        token,
        submitAdsForModeration: true,
        logger: (entry) => this.log({ ...entry, businessId: this.businessId }),
        ...(this.fetchImpl !== undefined && { fetch: this.fetchImpl }),
      });
    });
    return this.inner;
  }

  capabilities(): PlatformCapabilities {
    return YANDEX_DIRECT_CAPABILITIES;
  }

  async createCampaign(input: NewCampaign): Promise<PlatformCampaign> {
    return (await this.platform()).createCampaign(input);
  }

  async getCampaigns(ids: readonly string[]): Promise<PlatformCampaign[]> {
    return (await this.platform()).getCampaigns(ids);
  }

  async updateCampaign(id: string, patch: CampaignPatch): Promise<PlatformCampaign> {
    return (await this.platform()).updateCampaign(id, patch);
  }

  async uploadImage(png: Uint8Array, name: string): Promise<string> {
    return (await this.platform()).uploadImage(png, name);
  }

  async createAd(input: NewAd): Promise<PlatformAd> {
    return (await this.platform()).createAd(input);
  }

  async getAds(campaignIds: readonly string[]): Promise<PlatformAd[]> {
    return (await this.platform()).getAds(campaignIds);
  }

  async updateAd(id: string, patch: AdPatch): Promise<PlatformAd> {
    return (await this.platform()).updateAd(id, patch);
  }

  async checkChanges(campaignIds: readonly string[], since: Date): Promise<ChangesResult> {
    return (await this.platform()).checkChanges(campaignIds, since);
  }

  async getStats(campaignIds: readonly string[], from: LocalDate, to: LocalDate): Promise<DailyStatRow[]> {
    return (await this.platform()).getStats(campaignIds, from, to);
  }

  async getBreakdown(campaignIds: readonly string[], from: LocalDate, to: LocalDate, dimension: BreakdownDimension): Promise<BreakdownRow[]> {
    return (await this.platform()).getBreakdown(campaignIds, from, to, dimension);
  }

  async getTrafficSettings(campaignIds: readonly string[]): Promise<TrafficSettings[]> {
    return (await this.platform()).getTrafficSettings(campaignIds);
  }

  async getBalance(): Promise<Kopecks> {
    return (await this.platform()).getBalance();
  }
}
