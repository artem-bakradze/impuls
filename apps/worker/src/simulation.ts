import type { AgentRuntime } from "@impuls/agent";
import { SimulatedPlatform } from "@impuls/platforms";
import type { AdTruth } from "@impuls/platforms";
import { rubles } from "@impuls/core";
import type { CsoSource, LocalDate } from "@impuls/core";
import { ManualClock } from "./clock";
import type { JobContext } from "./context";
import { dispatchHour } from "./dispatcher";
import { CommandExecutor } from "./executor";
import { InMemoryMiniSiteStore } from "@impuls/minisite";
import { MemoryLockManager } from "./locks";
import type { LockManager } from "./locks";
import { MemoryStore } from "./store";
import type { BusinessRecord, Store } from "./store";

export interface SimulationOptions {
  start: Date;
  seed: number;
  agent: AgentRuntime;
  timeZone?: string;
  defaultTruth?: AdTruth;
  /** Daily probability of a retroactive stats correction (default 5%). */
  correctionProbability?: number;
  /** Defaults to in-memory implementations; integration tests pass PostgreSQL ones. */
  store?: Store;
  locks?: LockManager;
}

export interface SimulatedDirection {
  name: string;
  weeklyLimitRub: number;
  ads: { title: string; truth: AdTruth }[];
}

/**
 * Drives job handlers on a virtual clock against the market simulator (design decision 2).
 * Lets tests run 30 days in seconds and model worker outages by skipping handlers.
 */
export class SimulationDriver {
  readonly clock: ManualClock;
  readonly store: Store;
  readonly miniSites = new InMemoryMiniSiteStore();
  readonly locks: LockManager;
  readonly platform: SimulatedPlatform;
  readonly executor: CommandExecutor;
  readonly ctx: JobContext;
  private readonly pendingTruths: AdTruth[] = [];
  readonly timeZone: string;

  constructor(options: SimulationOptions) {
    this.clock = new ManualClock(options.start);
    this.store = options.store ?? new MemoryStore();
    this.locks = options.locks ?? new MemoryLockManager();
    this.timeZone = options.timeZone ?? "Europe/Moscow";
    const fallback: AdTruth = options.defaultTruth ?? { impressionsPerDay: 400, ctr: 0.05, cr: 0.05, costPerClick: rubles(25) };
    this.platform = new SimulatedPlatform({
      seed: options.seed,
      timeZone: this.timeZone,
      now: () => this.clock.now(),
      truthFor: () => this.pendingTruths.shift() ?? fallback,
      ...(options.correctionProbability !== undefined ? { correctionProbability: options.correctionProbability } : {}),
    });
    this.executor = new CommandExecutor({
      store: this.store,
      locks: this.locks,
      clock: this.clock,
      platformFor: () => this.platform,
      miniSites: this.miniSites,
    });
    this.ctx = {
      store: this.store,
      clock: this.clock,
      locks: this.locks,
      executor: this.executor,
      platformFor: () => this.platform,
      agent: options.agent,
    };
  }

  /** Creates a launched business with campaigns and ads, as the launch wizard would. */
  async launchBusiness(input: {
    id: string;
    monthlyBudgetRub: number;
    launchedOn: LocalDate;
    csoSource: CsoSource;
    directions: SimulatedDirection[];
  }): Promise<BusinessRecord> {
    const business: BusinessRecord = {
      id: input.id,
      userId: `user-${input.id}`,
      timeZone: this.timeZone,
      monthlyBudgetRub: input.monthlyBudgetRub,
      launchedOn: input.launchedOn,
      csoSource: input.csoSource,
      autonomy: "auto",
      miniSite: null,
      weeklySummaryEnabled: true,
      card: { category: "Маникюрный салон", services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }], area: "м. Профсоюзная", hours: "10:00–22:00", advantages: ["Работаем до 22:00"] },
    };
    await this.store.saveBusiness(business);
    let n = 1;
    for (const direction of input.directions) {
      const campaign = await this.platform.createCampaign({
        name: `[Импульс] ${direction.name}`,
        weeklyLimit: rubles(direction.weeklyLimitRub),
        strategyId: "WB_MAXIMUM_CLICKS",
        siteMonitoring: true,
      });
      const directionId = `${input.id}-d${n++}`;
      await this.store.saveDirection({
        id: directionId,
        businessId: input.id,
        name: direction.name,
        channel: "search",
        status: "active",
        weeklyLimit: campaign.weeklyLimit,
        strategyId: campaign.strategyId,
        createdOn: input.launchedOn,
        lastLimitIncreaseOn: null,
        lastStrategyChangeOn: null,
        platformCampaignId: campaign.id,
        pausedByBudget: false,
        pausedByUser: false,
        schedule: "Пн–Вс 10:00–22:00",
        geoRadiusKm: 3,
      });
      let m = 1;
      for (const ad of direction.ads) {
        this.pendingTruths.push(ad.truth);
        const platformAd = await this.platform.createAd({ campaignId: campaign.id, title: ad.title, text: ad.title });
        await this.store.saveAd({
          id: `${directionId}-a${m++}`,
          directionId,
          status: "active",
          title: ad.title,
          text: ad.title,
          createdOn: input.launchedOn,
          platformAdId: platformAd.id,
          moderation: "accepted",
        });
      }
    }
    return business;
  }

  /** Advances the virtual clock hour by hour; `workerDown` skips job handlers to model outages. */
  async runHours(hours: number, options: { workerDown?: (at: Date) => boolean } = {}): Promise<void> {
    for (let i = 0; i < hours; i++) {
      this.clock.advanceHours(1);
      const at = this.clock.now();
      this.platform.advanceHour(at);
      if (!options.workerDown?.(at)) {
        await dispatchHour(this.ctx);
      }
    }
  }

  runDays(days: number, options: { workerDown?: (at: Date) => boolean } = {}): Promise<void> {
    return this.runHours(days * 24, options);
  }
}
