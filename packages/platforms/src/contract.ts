import type { Channel, Kopecks, LocalDate, ObjectStatus } from "@impuls/core";

export interface StrategyCapability {
  id: string;
  title: string;
  /** Pays for leads: needs a Metrica goal and a target cost per lead (`LeadGoal`). */
  requiresLeadGoal: boolean;
}

/** Platform-specific capabilities the agent and guards rely on (design decision 5). */
export interface PlatformCapabilities {
  platform: string;
  strategies: readonly StrategyCapability[];
  minWeeklyLimit: Kopecks;
}

export interface PlatformCampaign {
  id: string;
  name: string;
  status: ObjectStatus;
  weeklyLimit: Kopecks;
  strategyId: string;
  siteMonitoring: boolean;
  /** Display schedule, e.g. "Пн–Вс 10:00–22:00"; optional until every adapter supports it. */
  schedule?: string;
  geoRadiusKm?: number;
}

export type ModerationStatus = "accepted" | "pending" | "rejected";

export interface PlatformAd {
  id: string;
  campaignId: string;
  status: ObjectStatus;
  title: string;
  text: string;
  moderation: ModerationStatus;
  rejectionReason: string | null;
}

/** Metrica goal that counts leads and the target cost per lead (ЦСО) for lead-paying strategies. */
export interface LeadGoal {
  goalId: string;
  targetCostPerLead: Kopecks;
}

/** Where and for what the campaign is shown. The adapter maps the city to its own regions (design decision 6). */
export interface Targeting {
  /** City of the business, e.g. "Москва". */
  city: string;
  /** Search phrases; required for the search channel, optional for partner sites. */
  keywords: readonly string[];
  negativeKeywords: readonly string[];
}

export interface NewCampaign {
  name: string;
  channel: Channel;
  weeklyLimit: Kopecks;
  strategyId: string;
  /** Required when the strategy declares `requiresLeadGoal`. */
  leadGoal?: LeadGoal;
  siteMonitoring: boolean;
  targeting: Targeting;
  /** Display schedule, e.g. "Пн–Вс 10:00–22:00". */
  schedule: string;
}

export interface NewAd {
  campaignId: string;
  title: string;
  text: string;
  /** Landing page (own site or mini-site) without tracking tags; the adapter adds its UTM tags. */
  landingUrl: string;
}

export interface CampaignPatch {
  status?: ObjectStatus;
  weeklyLimit?: Kopecks;
  strategyId?: string;
  /** Required when switching to a strategy that declares `requiresLeadGoal`. */
  leadGoal?: LeadGoal;
  siteMonitoring?: boolean;
  schedule?: string;
  geoRadiusKm?: number;
}

export interface AdPatch {
  status?: ObjectStatus;
  title?: string;
  text?: string;
}

/** Mirrors Direct `Changes.checkCampaigns`: SELF — campaign params, CHILDREN — groups/ads, STAT — stats corrections. */
export type ChangeArea = "SELF" | "CHILDREN" | "STAT";

export interface ChangesResult {
  checkedAt: Date;
  campaigns: { campaignId: string; areas: ChangeArea[] }[];
}

export interface DailyStatRow {
  date: LocalDate;
  campaignId: string;
  adId: string;
  impressions: number;
  clicks: number;
  leads: number;
  spend: Kopecks;
}

/** Single contract for all ad platforms. Adding a platform means adding an adapter, not changing the core. */
export interface AdPlatform {
  capabilities(): PlatformCapabilities;
  createCampaign(input: NewCampaign): Promise<PlatformCampaign>;
  getCampaigns(ids: readonly string[]): Promise<PlatformCampaign[]>;
  updateCampaign(id: string, patch: CampaignPatch): Promise<PlatformCampaign>;
  createAd(input: NewAd): Promise<PlatformAd>;
  getAds(campaignIds: readonly string[]): Promise<PlatformAd[]>;
  updateAd(id: string, patch: AdPatch): Promise<PlatformAd>;
  checkChanges(campaignIds: readonly string[], since: Date): Promise<ChangesResult>;
  /** Stats with VAT, by day and ad, as the platform currently reports them. */
  getStats(campaignIds: readonly string[], from: LocalDate, to: LocalDate): Promise<DailyStatRow[]>;
  getBalance(): Promise<Kopecks>;
}

export class PlatformError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}
