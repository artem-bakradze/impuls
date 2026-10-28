import {
  addDays,
  createRng,
  sampleBinomial,
  samplePoisson,
  seedFromString,
  toLocalDate,
  weekStart,
} from "@impuls/core";
import type { Kopecks, LocalDate } from "@impuls/core";
import { PlatformError } from "./contract";
import type {
  AdPatch,
  AdPlatform,
  CampaignPatch,
  ChangeArea,
  ChangesResult,
  DailyStatRow,
  NewAd,
  NewCampaign,
  PlatformAd,
  PlatformCampaign,
  PlatformCapabilities,
} from "./contract";

/** Hidden "true" parameters of an ad; the service never sees them. */
export interface AdTruth {
  impressionsPerDay: number;
  ctr: number;
  /** Conversion click → lead. */
  cr: number;
  costPerClick: Kopecks;
}

export interface SimulatorOptions {
  seed: number;
  timeZone: string;
  now: () => Date;
  truthFor: (ad: PlatformAd) => AdTruth;
  /** Max delay before an hour of stats becomes visible. */
  maxStatsDelayHours?: number;
  /** Daily probability that a past day gets corrected (invalid clicks written off). */
  correctionProbability?: number;
  balance?: Kopecks;
}

interface StatCell extends DailyStatRow {
  availableAt: number;
}

export const SIMULATOR_CAPABILITIES: PlatformCapabilities = {
  platform: "simulator",
  strategies: [
    { id: "WB_MAXIMUM_CLICKS", title: "Максимум кликов с недельным лимитом" },
    { id: "AVERAGE_CPA", title: "Оптимизация обращений по средней цене" },
  ],
  minWeeklyLimit: 30_000,
};

/**
 * Market simulator implementing the platform contract (testing-harness spec).
 * Generates stats hour by hour, respects weekly limits, delays and corrects data,
 * emulates the Changes service and manual edits in the ad cabinet.
 */
export class SimulatedPlatform implements AdPlatform {
  private readonly campaigns = new Map<string, PlatformCampaign>();
  private readonly ads = new Map<string, PlatformAd>();
  private readonly truths = new Map<string, AdTruth>();
  private readonly cells: StatCell[] = [];
  private readonly changes: { campaignId: string; area: ChangeArea; at: number }[] = [];
  private readonly weekSpend = new Map<string, Kopecks>();
  private readonly rng: () => number;
  private nextId = 1;
  private balance: Kopecks;

  constructor(private readonly options: SimulatorOptions) {
    this.rng = createRng(options.seed);
    this.balance = options.balance ?? 100_000_000;
  }

  capabilities(): PlatformCapabilities {
    return SIMULATOR_CAPABILITIES;
  }

  private id(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  /** Manual edits happen strictly after any check made at the same virtual instant. */
  private record(campaignId: string, area: ChangeArea): void {
    this.changes.push({ campaignId, area, at: this.options.now().getTime() + 1 });
  }

  private campaign(id: string): PlatformCampaign {
    const campaign = this.campaigns.get(id);
    if (!campaign) {
      throw new PlatformError("NOT_FOUND", `Campaign ${id} not found`, false);
    }
    return campaign;
  }

  private ad(id: string): PlatformAd {
    const ad = this.ads.get(id);
    if (!ad) {
      throw new PlatformError("NOT_FOUND", `Ad ${id} not found`, false);
    }
    return ad;
  }

  createCampaign(input: NewCampaign): Promise<PlatformCampaign> {
    const campaign: PlatformCampaign = { id: this.id("c"), status: "active", ...input };
    this.campaigns.set(campaign.id, campaign);
    return Promise.resolve({ ...campaign });
  }

  getCampaigns(ids: readonly string[]): Promise<PlatformCampaign[]> {
    return Promise.resolve(ids.map((id) => ({ ...this.campaign(id) })));
  }

  updateCampaign(id: string, patch: CampaignPatch): Promise<PlatformCampaign> {
    const campaign = this.campaign(id);
    Object.assign(campaign, patch);
    return Promise.resolve({ ...campaign });
  }

  createAd(input: NewAd): Promise<PlatformAd> {
    this.campaign(input.campaignId);
    const ad: PlatformAd = { id: this.id("a"), status: "active", moderation: "accepted", rejectionReason: null, ...input };
    this.ads.set(ad.id, ad);
    this.truths.set(ad.id, this.options.truthFor(ad));
    return Promise.resolve({ ...ad });
  }

  getAds(campaignIds: readonly string[]): Promise<PlatformAd[]> {
    return Promise.resolve([...this.ads.values()].filter((ad) => campaignIds.includes(ad.campaignId)).map((ad) => ({ ...ad })));
  }

  updateAd(id: string, patch: AdPatch): Promise<PlatformAd> {
    const ad = this.ad(id);
    Object.assign(ad, patch);
    return Promise.resolve({ ...ad });
  }

  checkChanges(campaignIds: readonly string[], since: Date): Promise<ChangesResult> {
    const byCampaign = new Map<string, Set<ChangeArea>>();
    for (const change of this.changes) {
      if (change.at > since.getTime() && campaignIds.includes(change.campaignId)) {
        const areas = byCampaign.get(change.campaignId) ?? new Set<ChangeArea>();
        areas.add(change.area);
        byCampaign.set(change.campaignId, areas);
      }
    }
    return Promise.resolve({
      checkedAt: this.options.now(),
      campaigns: [...byCampaign].map(([campaignId, areas]) => ({ campaignId, areas: [...areas] })),
    });
  }

  getStats(campaignIds: readonly string[], from: LocalDate, to: LocalDate): Promise<DailyStatRow[]> {
    const now = this.options.now().getTime();
    const rows = new Map<string, DailyStatRow>();
    for (const cell of this.cells) {
      if (cell.availableAt > now || cell.date < from || cell.date > to || !campaignIds.includes(cell.campaignId)) {
        continue;
      }
      const key = `${cell.date}|${cell.adId}`;
      const row = rows.get(key) ?? { date: cell.date, campaignId: cell.campaignId, adId: cell.adId, impressions: 0, clicks: 0, leads: 0, spend: 0 };
      row.impressions += cell.impressions;
      row.clicks += cell.clicks;
      row.leads += cell.leads;
      row.spend += cell.spend;
      rows.set(key, row);
    }
    return Promise.resolve([...rows.values()]);
  }

  getBalance(): Promise<Kopecks> {
    return Promise.resolve(this.balance);
  }

  // --- Simulation controls (not part of the platform contract) ---

  /** A change made by the user directly in the ad cabinet, bypassing the service. */
  cabinetEditCampaign(id: string, patch: CampaignPatch): void {
    Object.assign(this.campaign(id), patch);
    this.record(id, "SELF");
  }

  cabinetEditAd(id: string, patch: AdPatch): void {
    const ad = this.ad(id);
    Object.assign(ad, patch);
    this.record(ad.campaignId, "CHILDREN");
  }

  /** Moderation verdict from the platform side. */
  moderate(adId: string, moderation: PlatformAd["moderation"], rejectionReason: string | null = null): void {
    const ad = this.ad(adId);
    ad.moderation = moderation;
    ad.rejectionReason = rejectionReason;
    this.record(ad.campaignId, "CHILDREN");
  }

  setBalance(balance: Kopecks): void {
    this.balance = balance;
  }

  setTruth(adId: string, truth: AdTruth): void {
    this.truths.set(adId, truth);
  }

  /** Real spend (including not yet visible stats) — for test assertions only. */
  trueSpend(campaignIds: readonly string[], from: LocalDate, to: LocalDate): Kopecks {
    return this.cells
      .filter((c) => campaignIds.includes(c.campaignId) && c.date >= from && c.date <= to)
      .reduce((sum, c) => sum + c.spend, 0);
  }

  /** Generates one hour of traffic that ends at `hourEnd`. */
  advanceHour(hourEnd: Date): void {
    const date = toLocalDate(new Date(hourEnd.getTime() - 1), this.options.timeZone);
    const dayRng = createRng(seedFromString(`${this.options.seed}|${date}`));
    const dayFactor = 0.5 + dayRng() * 1.5;
    for (const campaign of this.campaigns.values()) {
      if (campaign.status !== "active") {
        continue;
      }
      const weekKey = `${campaign.id}|${weekStart(date)}`;
      let spentThisWeek = this.weekSpend.get(weekKey) ?? 0;
      const dailyCap = (campaign.weeklyLimit / 7) * 2;
      const spentToday = this.cells.filter((c) => c.campaignId === campaign.id && c.date === date).reduce((s, c) => s + c.spend, 0);
      let dayRoom = Math.max(0, dailyCap - spentToday);
      for (const ad of this.ads.values()) {
        if (ad.campaignId !== campaign.id || ad.status !== "active" || ad.moderation !== "accepted") {
          continue;
        }
        const truth = this.truths.get(ad.id);
        if (!truth) {
          continue;
        }
        const impressions = samplePoisson(this.rng, (truth.impressionsPerDay * dayFactor) / 24);
        let clicks = sampleBinomial(this.rng, impressions, truth.ctr);
        const weekRoom = campaign.weeklyLimit - spentThisWeek;
        const affordable = Math.floor(Math.min(weekRoom, dayRoom) / truth.costPerClick);
        clicks = Math.max(0, Math.min(clicks, affordable));
        const leads = sampleBinomial(this.rng, clicks, truth.cr);
        const spend = clicks * truth.costPerClick;
        spentThisWeek += spend;
        dayRoom -= spend;
        this.balance -= spend;
        const delay = Math.floor(this.rng() * ((this.options.maxStatsDelayHours ?? 6) + 1));
        this.cells.push({
          date,
          campaignId: campaign.id,
          adId: ad.id,
          impressions,
          clicks,
          leads,
          spend,
          availableAt: hourEnd.getTime() + delay * 3_600_000,
        });
      }
      this.weekSpend.set(weekKey, spentThisWeek);
    }
    if (new Date(hourEnd.getTime()).getUTCHours() === 0 && this.rng() < (this.options.correctionProbability ?? 0.05)) {
      this.correctPastDay(addDays(date, -2), hourEnd);
    }
  }

  /** Writes off ~5% of a past day's spend as invalid clicks, like Direct does. */
  private correctPastDay(date: LocalDate, at: Date): void {
    const affected = new Set<string>();
    for (const cell of this.cells) {
      if (cell.date === date && cell.spend > 0) {
        const writeOff = Math.floor(cell.spend * 0.05);
        cell.spend -= writeOff;
        this.balance += writeOff;
        affected.add(cell.campaignId);
      }
    }
    for (const campaignId of affected) {
      this.changes.push({ campaignId, area: "STAT", at: at.getTime() });
    }
  }
}
