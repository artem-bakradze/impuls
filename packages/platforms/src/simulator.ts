import { createHash } from "node:crypto";
import {
  addDays,
  createRng,
  sampleBinomial,
  samplePoisson,
  seedFromString,
  toLocalDate,
  weekStart,
} from "@impuls/core";
import type { Kopecks, LocalDate, Rng } from "@impuls/core";
import { NO_DEVICE_ADJUSTMENTS, PlatformError } from "./contract";
import { allocate, effectiveTraffic, isNeutral, segmentCells, splitTotals } from "./simulator-segments";
import type { DeviceTruth, QueryTruth } from "./simulator-segments";
import type {
  AdPatch,
  AdPlatform,
  BreakdownDimension,
  BreakdownRow,
  CampaignPatch,
  ChangeArea,
  ChangesResult,
  DailyStatRow,
  Device,
  DeviceAdjustments,
  LeadGoal,
  NewAd,
  NewCampaign,
  PlatformAd,
  PlatformCampaign,
  PlatformCapabilities,
  Targeting,
  TrafficSettings,
} from "./contract";

/** Hidden "true" parameters of an ad; the service never sees them. */
export interface AdTruth {
  impressionsPerDay: number;
  ctr: number;
  /** Conversion click → lead. */
  cr: number;
  costPerClick: Kopecks;
  /** Device split of the ad's traffic (add-agent-analyst-stage1); `DEFAULT_DEVICES` without it. */
  devices?: Partial<Record<Device, DeviceTruth>>;
  /** Search queries of the ad's traffic; the campaign's key phrases with equal shares without them. */
  queries?: readonly QueryTruth[];
}

/** Negative phrases and bid adjustments of a campaign from some moment on: cells keep the index of theirs. */
export interface CampaignSettingsEntry {
  campaignId: string;
  negativeKeywords: readonly string[];
  deviceAdjustments: DeviceAdjustments;
}

export interface SimulatorOptions {
  seed: number;
  timeZone: string;
  now: () => Date;
  /** Null for a market without its own traffic: the simulation mode, where the owner enters the stats. */
  truthFor: (ad: PlatformAd) => AdTruth | null;
  /**
   * Prefix of object ids. The simulator keeps its state in memory, so a long-running stand passes a per-start
   * prefix: ids of a restarted simulator must not collide with campaigns already stored in the database.
   */
  idPrefix?: string;
  /** Max delay before an hour of stats becomes visible. */
  maxStatsDelayHours?: number;
  /** Daily probability that a past day gets corrected (invalid clicks written off). */
  correctionProbability?: number;
  balance?: Kopecks;
  /** Strategy catalog and minimum limit; the simulation mode uses Direct's, so the rules work within its bounds. */
  capabilities?: PlatformCapabilities;
}

/** Everything the simulator knows, as plain JSON: saved between ticks of the simulation mode (add-simulation-mode). */
export interface SimulatorState {
  campaigns: PlatformCampaign[];
  settings: [string, { channel: NewCampaign["channel"]; targeting: Targeting; leadGoal: LeadGoal | null }][];
  ads: PlatformAd[];
  landingUrls: [string, string][];
  truths: [string, AdTruth][];
  cells: StatCell[];
  changes: { campaignId: string; area: ChangeArea; at: number }[];
  weekSpend: [string, Kopecks][];
  rng: number;
  nextId: number;
  balance: Kopecks;
  /** Absent in states saved before add-agent-analyst-stage1. */
  settingsLog?: CampaignSettingsEntry[];
}

/** Hourly cells older than this are merged into daily ones: corrections touch only the day before yesterday. */
const COMPACT_AFTER_DAYS = 3;

export interface StatCell extends DailyStatRow {
  availableAt: number;
  /** Index of the campaign settings in force when the cell was made (`settingsLog`). */
  mix?: number;
  /** Entered by the owner for a period (simulation-mode «Статистика периода от владельца»): no breakdown by segment. */
  entered?: true;
}

/** What the owner entered for one ad over a period; money in kopecks. */
export interface PeriodAdTotals {
  adId: string;
  impressions: number;
  clicks: number;
  leads: number;
  spend: Kopecks;
}

/**
 * Direct's spending room of one campaign on each day of a period, by the rule the simulator keeps hour by hour: at
 * most twice an average day, at most the weekly limit in a week from Monday (simulation-on-owner-numbers decision 2).
 */
export const periodRoom = (
  weeklyLimit: Kopecks,
  dates: readonly LocalDate[],
  spentOn: (date: LocalDate) => Kopecks,
  spentInWeek: (monday: LocalDate) => Kopecks,
): Kopecks[] => {
  const dailyCap = Math.floor((weeklyLimit / 7) * 2);
  const weekLeft = new Map<LocalDate, number>();
  return dates.map((date) => {
    const monday = weekStart(date);
    const left = weekLeft.get(monday) ?? Math.max(0, weeklyLimit - spentInWeek(monday));
    const room = Math.max(0, Math.min(dailyCap - spentOn(date), left));
    weekLeft.set(monday, left - room);
    return room;
  });
};

/** A campaign's day and week caps over the dates, by the same rule as `periodRoom`. */
export const periodCaps = (
  weeklyLimit: Kopecks,
  dates: readonly LocalDate[],
  spentOn: (date: LocalDate) => Kopecks,
  spentInWeek: (monday: LocalDate) => Kopecks,
): PeriodCaps => {
  const dailyCap = Math.floor((weeklyLimit / 7) * 2);
  const weeks = new Map<LocalDate, number[]>();
  dates.forEach((date, i) => weeks.set(weekStart(date), [...(weeks.get(weekStart(date)) ?? []), i]));
  return {
    day: dates.map((date) => Math.max(0, dailyCap - spentOn(date))),
    weeks: [...weeks].map(([monday, days]) => ({ days, cap: Math.max(0, weeklyLimit - spentInWeek(monday)) })),
  };
};

/** The room of a campaign of a saved market: zero on every day for a stopped or unknown one. */
export const campaignRoom = (state: Pick<SimulatorState, "campaigns" | "cells" | "weekSpend">, campaignId: string, dates: readonly LocalDate[]): Kopecks[] => {
  const campaign = state.campaigns.find((c) => c.id === campaignId);
  if (campaign === undefined || campaign.status !== "active") return dates.map(() => 0);
  const weekSpend = new Map(state.weekSpend);
  const spentOn = (date: LocalDate) => state.cells.filter((c) => c.campaignId === campaignId && c.date === date).reduce((s, c) => s + c.spend, 0);
  return periodRoom(campaign.weeklyLimit, dates, spentOn, (monday) => weekSpend.get(`${campaignId}|${monday}`) ?? 0);
};

/**
 * Shares of `total` proportional to `weights`, each at most its `cap` (water filling): the ones with less room get all
 * of it, the others the same level per weight. The amounts are not rounded.
 */
const waterFill = (total: number, caps: readonly number[], weights: readonly number[]): number[] => {
  const shares = caps.map(() => 0);
  let left = total;
  let open = caps.map((_, i) => i).filter((i) => (weights[i] ?? 0) > 0);
  while (left > 0 && open.length > 0) {
    const level = left / open.reduce((s, i) => s + (weights[i] ?? 0), 0);
    const full = open.filter((i) => (caps[i] ?? 0) <= level * (weights[i] ?? 0));
    if (full.length === 0) {
      for (const i of open) shares[i] = level * (weights[i] ?? 0);
      return shares;
    }
    for (const i of full) {
      left -= caps[i] ?? 0;
      shares[i] = caps[i] ?? 0;
    }
    open = open.filter((i) => !full.includes(i));
  }
  return shares;
};

/** A campaign's limits over a period: what each day may still spend, and what each week from Monday may. */
export interface PeriodCaps {
  day: Kopecks[];
  weeks: { days: number[]; cap: Kopecks }[];
}

/**
 * Whole kopecks of `total` spread over the days as evenly as the limits allow (simulation-on-owner-numbers decision 3):
 * first by the weeks, by their number of days and at most their room, then by the days of each week, at most a day's
 * cap. Neither a day nor a week goes over, and a period does not spend its week's limit by Thursday.
 */
export const evenUnderLimits = (total: Kopecks, caps: PeriodCaps): Kopecks[] => {
  const weekRoom = caps.weeks.map((w) => Math.min(w.cap, w.days.reduce((s, d) => s + (caps.day[d] ?? 0), 0)));
  const weekly = allocate(total, waterFill(total, weekRoom, caps.weeks.map((w) => w.days.length)));
  const out = caps.day.map(() => 0);
  caps.weeks.forEach((week, k) => {
    const amount = weekly[k] ?? 0;
    const dayCaps = week.days.map((d) => caps.day[d] ?? 0);
    const days = allocate(amount, waterFill(amount, dayCaps, dayCaps.map(() => 1)));
    week.days.forEach((d, j) => {
      out[d] = days[j] ?? 0;
    });
  });
  return out;
};

/** Moves single units between the days of the rows until every day adds up to `columns`; the rows keep their sums. */
const fitColumns = (rows: number[][], columns: readonly number[]): void => {
  for (;;) {
    const sums = columns.map((_, d) => rows.reduce((s, r) => s + (r[d] ?? 0), 0));
    const over = sums.findIndex((s, d) => s > (columns[d] ?? 0));
    if (over < 0) return;
    const under = sums.findIndex((s, d) => s < (columns[d] ?? 0));
    const row = rows.find((r) => (r[over] ?? 0) > 0);
    if (under < 0 || row === undefined) throw new Error("Period spend does not fit the days");
    row[over] = (row[over] ?? 0) - 1;
    row[under] = (row[under] ?? 0) + 1;
  }
};

/** Moves units of `child` from days where it is above `parent` to days with room, e.g. clicks under impressions. */
const fitUnder = (child: number[], parent: readonly number[]): void => {
  for (let d = 0; d < child.length; d++) {
    while ((child[d] ?? 0) > (parent[d] ?? 0)) {
      const e = child.findIndex((c, i) => c < (parent[i] ?? 0));
      if (e < 0) throw new Error("Period totals do not fit the days");
      child[d] = (child[d] ?? 0) - 1;
      child[e] = (child[e] ?? 0) + 1;
    }
  }
};

export const SIMULATOR_CAPABILITIES: PlatformCapabilities = {
  platform: "simulator",
  strategies: [
    { id: "WB_MAXIMUM_CLICKS", title: "Максимум кликов с недельным лимитом", requiresLeadGoal: false },
    { id: "AVERAGE_CPA", title: "Оптимизация обращений по средней цене", requiresLeadGoal: true },
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
  /** Launch settings the simulator keeps but does not use for the "true" ad parameters. */
  private readonly settings = new Map<string, { channel: NewCampaign["channel"]; targeting: Targeting; leadGoal: LeadGoal | null }>();
  private readonly ads = new Map<string, PlatformAd>();
  private readonly landingUrls = new Map<string, string>();
  private readonly truths = new Map<string, AdTruth>();
  private cells: StatCell[] = [];
  private readonly changes: { campaignId: string; area: ChangeArea; at: number }[] = [];
  private readonly weekSpend = new Map<string, Kopecks>();
  private settingsLog: CampaignSettingsEntry[] = [];
  private rng: Rng;
  private nextId = 1;
  private balance: Kopecks;
  private nextCreateError: PlatformError | null = null;

  constructor(private readonly options: SimulatorOptions) {
    this.rng = createRng(options.seed);
    this.balance = options.balance ?? 100_000_000;
  }

  capabilities(): PlatformCapabilities {
    return this.options.capabilities ?? SIMULATOR_CAPABILITIES;
  }

  private needsLeadGoal(strategyId: string): boolean {
    return this.capabilities().strategies.some((s) => s.id === strategyId && s.requiresLeadGoal);
  }

  /** A copy of the whole state; `restore` on a simulator with the same options continues exactly from here. */
  snapshot(): SimulatorState {
    return structuredClone({
      campaigns: [...this.campaigns.values()],
      settings: [...this.settings],
      ads: [...this.ads.values()],
      landingUrls: [...this.landingUrls],
      truths: [...this.truths],
      cells: this.cells,
      changes: this.changes,
      weekSpend: [...this.weekSpend],
      rng: this.rng.state(),
      nextId: this.nextId,
      balance: this.balance,
      settingsLog: this.settingsLog,
    });
  }

  restore(saved: SimulatorState): void {
    const state = structuredClone(saved);
    const refill = <K, V>(map: Map<K, V>, entries: [K, V][]) => {
      map.clear();
      for (const [key, value] of entries) map.set(key, value);
    };
    refill(this.campaigns, state.campaigns.map((c) => [c.id, c]));
    refill(this.settings, state.settings);
    refill(this.ads, state.ads.map((a) => [a.id, a]));
    refill(this.landingUrls, state.landingUrls);
    refill(this.truths, state.truths);
    refill(this.weekSpend, state.weekSpend);
    this.cells = state.cells;
    this.changes.splice(0, this.changes.length, ...state.changes);
    this.rng = createRng(state.rng);
    this.nextId = state.nextId;
    this.balance = state.balance;
    this.settingsLog = state.settingsLog ?? [];
  }

  /** Logs the campaign's negative phrases and bid adjustments from now on; later cells refer to this entry. */
  private logSettings(campaignId: string, patch: { negativeKeywords?: readonly string[] | undefined; deviceAdjustments?: DeviceAdjustments | undefined }): void {
    const current = this.settingsOf(campaignId, this.settingsIndex(campaignId));
    this.settingsLog.push({
      campaignId,
      negativeKeywords: [...(patch.negativeKeywords ?? current.negativeKeywords)],
      deviceAdjustments: { ...(patch.deviceAdjustments ?? current.deviceAdjustments) },
    });
  }

  private settingsIndex(campaignId: string): number | undefined {
    for (let i = this.settingsLog.length - 1; i >= 0; i--) {
      if (this.settingsLog[i]?.campaignId === campaignId) return i;
    }
    return undefined;
  }

  private settingsOf(campaignId: string, index: number | undefined): CampaignSettingsEntry {
    const logged = index === undefined ? undefined : this.settingsLog[index];
    if (logged) return logged;
    // Campaigns of states saved before the settings log: launch negative phrases, no adjustments.
    return { campaignId, negativeKeywords: this.settings.get(campaignId)?.targeting.negativeKeywords ?? [], deviceAdjustments: NO_DEVICE_ADJUSTMENTS };
  }

  /** Key phrases of a search campaign: its queries when the truth has none. */
  private fallbackQueries(campaignId: string): readonly string[] {
    const settings = this.settings.get(campaignId);
    return settings?.channel === "search" ? settings.targeting.keywords : [];
  }

  /** The ad's demand, lead rate and click price under the campaign's settings (design decision 9). */
  private traffic(truth: AdTruth, settings: CampaignSettingsEntry): Pick<AdTruth, "impressionsPerDay" | "ctr" | "cr" | "costPerClick"> {
    const queries = truth.queries?.map((q) => q.text) ?? this.fallbackQueries(settings.campaignId);
    if (isNeutral(settings.deviceAdjustments, settings.negativeKeywords, queries)) {
      return truth;
    }
    const mix = effectiveTraffic(segmentCells(truth, settings.deviceAdjustments, settings.negativeKeywords, this.fallbackQueries(settings.campaignId)));
    return { impressionsPerDay: truth.impressionsPerDay * mix.reach, ctr: truth.ctr, cr: mix.cr, costPerClick: mix.costPerClick };
  }

  /** Hidden truth of an ad; only the simulation screen reads it, never the rules. */
  truthOf(adId: string): AdTruth | null {
    return this.truths.get(adId) ?? null;
  }

  private id(prefix: string): string {
    return `${this.options.idPrefix ?? ""}${prefix}-${this.nextId++}`;
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
    if (this.nextCreateError) {
      const error = this.nextCreateError;
      this.nextCreateError = null;
      return Promise.reject(error);
    }
    // Same refusals as the Direct adapter, so launch and guard paths are exercised on the simulator too.
    if (input.channel === "search" && input.targeting.keywords.length === 0) {
      return Promise.reject(new PlatformError("KEYWORDS_REQUIRED", "A search campaign needs at least one keyword", false));
    }
    if (this.needsLeadGoal(input.strategyId) && !input.leadGoal) {
      return Promise.reject(new PlatformError("LEAD_GOAL_REQUIRED", `${input.strategyId} needs a lead goal`, false));
    }
    const { channel, targeting, leadGoal, ...params } = input;
    const campaign: PlatformCampaign = { id: this.id("c"), status: "active", ...params };
    this.campaigns.set(campaign.id, campaign);
    this.settings.set(campaign.id, { channel, targeting, leadGoal: leadGoal ?? null });
    this.logSettings(campaign.id, { negativeKeywords: targeting.negativeKeywords, deviceAdjustments: NO_DEVICE_ADJUSTMENTS });
    return Promise.resolve({ ...campaign });
  }

  /** Test helper: landing page an ad leads to. */
  landingUrlOf(adId: string): string {
    const url = this.landingUrls.get(adId);
    if (url === undefined) {
      throw new Error(`Unknown ad ${adId}`);
    }
    return url;
  }

  /** Test helper: channel, targeting and lead goal the campaign was launched with. */
  launchSettings(campaignId: string): { channel: NewCampaign["channel"]; targeting: Targeting; leadGoal: LeadGoal | null } {
    const settings = this.settings.get(campaignId);
    if (!settings) {
      throw new Error(`Unknown campaign ${campaignId}`);
    }
    return settings;
  }

  getCampaigns(ids: readonly string[]): Promise<PlatformCampaign[]> {
    return Promise.resolve(ids.map((id) => ({ ...this.campaign(id) })));
  }

  getTrafficSettings(campaignIds: readonly string[]): Promise<TrafficSettings[]> {
    return Promise.resolve(
      campaignIds.map((id) => {
        this.campaign(id);
        const settings = this.settingsOf(id, this.settingsIndex(id));
        return { campaignId: id, negativeKeywords: [...settings.negativeKeywords], deviceAdjustments: { ...settings.deviceAdjustments } };
      }),
    );
  }

  updateCampaign(id: string, patch: CampaignPatch): Promise<PlatformCampaign> {
    const campaign = this.campaign(id);
    const { leadGoal, city, negativeKeywords, deviceAdjustments, ...rest } = patch;
    if (rest.strategyId !== undefined && this.needsLeadGoal(rest.strategyId) && !leadGoal) {
      return Promise.reject(new PlatformError("LEAD_GOAL_REQUIRED", `${rest.strategyId} needs a lead goal`, false));
    }
    Object.assign(campaign, rest);
    const settings = this.settings.get(id);
    if (settings && leadGoal) {
      settings.leadGoal = leadGoal;
    }
    if (settings && city !== undefined) {
      settings.targeting = { ...settings.targeting, city };
    }
    if (negativeKeywords !== undefined || deviceAdjustments !== undefined) {
      this.logSettings(id, { negativeKeywords, deviceAdjustments });
    }
    return Promise.resolve({ ...campaign });
  }

  /** Takes a picture like Direct, without any request: the hash is the bytes' own, so the same picture has one hash. */
  uploadImage(png: Uint8Array, name: string): Promise<string> {
    if (png.length === 0 || name.trim() === "") {
      return Promise.reject(new PlatformError("IMAGE_INVALID", "The picture is empty or has no name", false));
    }
    return Promise.resolve(`sim-${createHash("sha256").update(png).digest("hex").slice(0, 20)}`);
  }

  createAd(input: NewAd): Promise<PlatformAd> {
    this.campaign(input.campaignId);
    const { landingUrl, imageHash, ...fields } = input;
    const ad: PlatformAd = { id: this.id("a"), status: "active", moderation: "accepted", rejectionReason: null, monitoringStopped: false, imageHash: imageHash ?? null, ...fields };
    this.ads.set(ad.id, ad);
    this.landingUrls.set(ad.id, landingUrl);
    const truth = this.options.truthFor(ad);
    if (truth !== null) this.truths.set(ad.id, truth);
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

  /**
   * Stats by search query or device: every visible cell's totals split by the segments of the hour it was made in, so
   * the breakdown always adds up to `getStats` (testing-harness spec «Правда симулятора по устройствам и запросам»).
   */
  getBreakdown(campaignIds: readonly string[], from: LocalDate, to: LocalDate, dimension: BreakdownDimension): Promise<BreakdownRow[]> {
    const now = this.options.now().getTime();
    const rows = new Map<string, BreakdownRow>();
    for (const cell of this.cells) {
      if (cell.availableAt > now || cell.date < from || cell.date > to || !campaignIds.includes(cell.campaignId)) {
        continue;
      }
      const truth = this.truths.get(cell.adId);
      if (!truth || cell.entered) continue;
      const settings = this.settingsOf(cell.campaignId, cell.mix);
      const parts = splitTotals(cell, segmentCells(truth, settings.deviceAdjustments, settings.negativeKeywords, this.fallbackQueries(cell.campaignId)), dimension);
      for (const [segment, part] of parts) {
        const key = `${cell.campaignId}|${segment}`;
        const row = rows.get(key) ?? { campaignId: cell.campaignId, segment, impressions: 0, clicks: 0, leads: 0, spend: 0 };
        row.impressions += part.impressions;
        row.clicks += part.clicks;
        row.leads += part.leads;
        row.spend += part.spend;
        rows.set(key, row);
      }
    }
    return Promise.resolve([...rows.values()]);
  }

  getBalance(): Promise<Kopecks> {
    return Promise.resolve(this.balance);
  }

  // --- Simulation controls (not part of the platform contract) ---

  /** A change made by the user directly in the ad cabinet, bypassing the service. */
  cabinetEditCampaign(id: string, patch: CampaignPatch): void {
    const { negativeKeywords, deviceAdjustments, ...rest } = patch;
    Object.assign(this.campaign(id), rest);
    if (negativeKeywords !== undefined || deviceAdjustments !== undefined) {
      this.logSettings(id, { negativeKeywords, deviceAdjustments });
    }
    this.record(id, "SELF");
  }

  cabinetEditAd(id: string, patch: AdPatch): void {
    const ad = this.ad(id);
    Object.assign(ad, patch);
    this.record(ad.campaignId, "CHILDREN");
  }

  /** Direct stopped the campaign's ads by site monitoring: the landing page does not open. */
  stopAdsBySiteMonitoring(campaignId: string): void {
    for (const ad of this.ads.values()) {
      if (ad.campaignId === campaignId) {
        ad.monitoringStopped = true;
      }
    }
    this.record(campaignId, "CHILDREN");
  }

  /** Moderation verdict from the platform side. */
  moderate(adId: string, moderation: PlatformAd["moderation"], rejectionReason: string | null = null): void {
    const ad = this.ad(adId);
    ad.moderation = moderation;
    ad.rejectionReason = rejectionReason;
    this.record(ad.campaignId, "CHILDREN");
  }

  /** The next campaign creation fails as the platform would (e.g. missing advertiser data). */
  failNextCampaignCreation(error: PlatformError): void {
    this.nextCreateError = error;
  }

  setBalance(balance: Kopecks): void {
    this.balance = balance;
  }

  setTruth(adId: string, truth: AdTruth): void {
    this.truths.set(adId, truth);
  }

  /** Spending room of a campaign on each of the dates under its current limit. */
  roomOf(campaignId: string, dates: readonly LocalDate[]): Kopecks[] {
    return campaignRoom({ campaigns: [...this.campaigns.values()], cells: this.cells, weekSpend: [...this.weekSpend] }, campaignId, dates);
  }

  /** The day and week caps of a campaign over the dates; none for a stopped one. */
  private capsOf(campaignId: string, dates: readonly LocalDate[]): PeriodCaps {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === undefined || campaign.status !== "active") return { day: dates.map(() => 0), weeks: [] };
    const spentOn = (date: LocalDate) => this.cells.filter((c) => c.campaignId === campaignId && c.date === date).reduce((s, c) => s + c.spend, 0);
    return periodCaps(campaign.weeklyLimit, dates, spentOn, (monday) => this.weekSpend.get(`${campaignId}|${monday}`) ?? 0);
  }

  /**
   * The owner's stats of a period (simulation-mode «Статистика периода от владельца»), visible at once. A campaign's
   * spend goes over the days evenly, each day at most its room, so neither a day nor a week goes over the limit and the
   * period does not end early; every ad's numbers follow its spend days, add up to what was entered exactly and keep
   * leads ≤ clicks ≤ impressions on each day.
   */
  recordPeriod(dates: readonly LocalDate[], totals: readonly PeriodAdTotals[]): void {
    const at = this.options.now().getTime();
    const byCampaign = new Map<string, PeriodAdTotals[]>();
    for (const row of totals) {
      const ad = this.ad(row.adId);
      byCampaign.set(ad.campaignId, [...(byCampaign.get(ad.campaignId) ?? []), row]);
    }
    for (const [campaignId, rows] of byCampaign) {
      const room = this.roomOf(campaignId, dates);
      const spend = rows.reduce((s, r) => s + r.spend, 0);
      if (spend > room.reduce((s, r) => s + r, 0)) {
        throw new PlatformError("PERIOD_OVER_LIMIT", `Period spend of ${campaignId} is over its room`, false);
      }
      const days = evenUnderLimits(spend, this.capsOf(campaignId, dates));
      const fallback = dates.map(() => 1);
      const spends = rows.map((r) => allocate(r.spend, days));
      fitColumns(spends, days);
      rows.forEach((row, i) => {
        const own = spends[i] ?? [];
        const weights = row.spend > 0 ? own : fallback;
        const impressions = allocate(row.impressions, weights);
        const clicks = allocate(row.clicks, weights);
        const leads = allocate(row.leads, weights);
        fitUnder(clicks, impressions);
        fitUnder(leads, clicks);
        dates.forEach((date, d) => {
          const cell = { impressions: impressions[d] ?? 0, clicks: clicks[d] ?? 0, leads: leads[d] ?? 0, spend: own[d] ?? 0 };
          if (cell.impressions + cell.clicks + cell.leads + cell.spend === 0) return;
          this.cells.push({ date, campaignId, adId: row.adId, ...cell, availableAt: at, entered: true });
        });
      });
      dates.forEach((date, d) => {
        const key = `${campaignId}|${weekStart(date)}`;
        this.weekSpend.set(key, (this.weekSpend.get(key) ?? 0) + (days[d] ?? 0));
      });
      this.balance -= spend;
    }
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
      // Direct rotates the ads of a group; starting each hour from another ad keeps a new A/B variant from getting
      // only what the older ads left of the limit. An ad stopped by site monitoring is not shown.
      const shown = [...this.ads.values()].filter(
        (ad) => ad.campaignId === campaign.id && ad.status === "active" && ad.moderation === "accepted" && ad.monitoringStopped !== true,
      );
      const first = shown.length === 0 ? 0 : Math.floor(hourEnd.getTime() / 3_600_000) % shown.length;
      const mix = this.settingsIndex(campaign.id);
      const settings = this.settingsOf(campaign.id, mix);
      for (const ad of [...shown.slice(first), ...shown.slice(0, first)]) {
        const adTruth = this.truths.get(ad.id);
        if (!adTruth) {
          continue;
        }
        const truth = this.traffic(adTruth, settings);
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
          ...(mix !== undefined && { mix }),
        });
      }
      this.weekSpend.set(weekKey, spentThisWeek);
    }
    if (new Date(hourEnd.getTime()).getUTCHours() === 0 && this.rng() < (this.options.correctionProbability ?? 0.05)) {
      this.correctPastDay(addDays(date, -2), hourEnd);
    }
    this.compact(addDays(date, -COMPACT_AFTER_DAYS));
  }

  /** Merges hourly cells of days before `before` into one cell per day and ad; totals do not change. */
  private compact(before: LocalDate): void {
    const merged = new Map<string, StatCell>();
    const kept: StatCell[] = [];
    for (const cell of this.cells) {
      if (cell.date >= before) {
        kept.push(cell);
        continue;
      }
      const key = `${cell.date}|${cell.adId}|${cell.mix ?? ""}|${cell.entered ? "e" : ""}`;
      const into = merged.get(key);
      if (!into) {
        merged.set(key, { ...cell });
        continue;
      }
      into.impressions += cell.impressions;
      into.clicks += cell.clicks;
      into.leads += cell.leads;
      into.spend += cell.spend;
      into.availableAt = Math.max(into.availableAt, cell.availableAt);
    }
    if (merged.size > 0 && merged.size < this.cells.length - kept.length) {
      this.cells = [...merged.values(), ...kept];
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
