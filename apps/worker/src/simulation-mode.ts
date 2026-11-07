import { TemplateCreativeEngine, TemplateImageEngine } from "@impuls/agent";
import { addDays, daysBetween, toLocalDate } from "@impuls/core";
import type { LocalDate } from "@impuls/core";
import { campaignRoom, campaignTraffic, SimulatedPlatform, YANDEX_DIRECT_CAPABILITIES } from "@impuls/platforms";
import type { SimulatorState } from "@impuls/platforms";
import { checkModerationAndBalance, reconcileStats } from "./analytics";
import { loadBusinessView } from "./state";
import { createLogger } from "./logger";
import type { SimulationWeekReport } from "./simulation-report";
import { checkPeriod, lastEntered, MARKET, periodDates, periodForm, simulationStartDate, splitPeriod } from "./simulation-period";
import type { DirectionTraffic, PeriodAdInput, PeriodDays, PeriodForm, PeriodMarket } from "./simulation-period";
import { ManualClock } from "./clock";
import type { JobContext } from "./context";
import { CommandExecutor } from "./executor";
import { recordOutcomes } from "./history";
import { budgetGuard, dailyEvaluation, reconcile, syncStats, verifyBudget } from "./jobs";
import { launchAds } from "./launch";
import type { LaunchPlan, LaunchResult } from "./launch";
import { adviseOnGoal, evaluateExperiments } from "./optimization";
import type { AdRecord, BusinessRecord, DirectionRecord, SimulationRecord, SimulationStep, Store } from "./store";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** `endsAt` of a new run: kept as stored, the run has no end (simulation-mode spec «Симуляция как отдельный режим»). */
const STORED_RUN_DAYS = 30;
/** The market of the owner's numbers generates nothing at random; its generator only has to be the same every time. */
const OWNER_MARKET_SEED = 1;

export class SimulationError extends Error {
  constructor(
    readonly code: "NOT_SIMULATED" | "ADS_CHANGED" | "PERIOD_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "SimulationError";
  }
}

export const simulationLockKey = (businessId: string): string => `sim:${businessId}`;

/**
 * The shared store with the writes that would leak virtual time into service-wide data switched off: team incidents
 * and heartbeats are about the real deployment, and a simulated date from the future would hide real problems.
 */
const simulationStore = (store: Store): Store =>
  new Proxy(store, {
    get(target, property, receiver) {
      if (property === "openIncident" || property === "beat") {
        return () => Promise.resolve();
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });

/** One business in the simulation: its virtual clock, its market and a job context bound to both. */
export interface SimulationWorld {
  record: SimulationRecord;
  business: BusinessRecord;
  clock: ManualClock;
  platform: SimulatedPlatform;
  ctx: JobContext;
}

/**
 * The training market: it carries out the changes of the ads but makes up no traffic of its own — the owner enters the
 * stats (simulation-mode spec «Режим бизнеса «Симуляция»»). Runs started with a scenario keep its truths in the saved
 * state, but nothing reads them any more.
 */
const newPlatform = (business: BusinessRecord, seed: number, clock: ManualClock): SimulatedPlatform =>
  new SimulatedPlatform({
    seed,
    timeZone: business.timeZone,
    now: () => clock.now(),
    truthFor: () => null,
    idPrefix: `sim-${business.id}-`,
    // The rules work within Direct's strategy catalog and minimum limit, as in the real mode.
    capabilities: YANDEX_DIRECT_CAPABILITIES,
  });

/**
 * Job context of a simulated business (add-simulation-mode decision 2): the same store, handlers and agent as the real
 * mode, its own clock and market, template A/B variants.
 */
export const simulationWorld = (base: JobContext, business: BusinessRecord, record: SimulationRecord): SimulationWorld => {
  const clock = new ManualClock(record.simNow);
  const platform = newPlatform(business, record.seed, clock);
  platform.restore(record.state);
  const store = simulationStore(base.store);
  const platformFor = () => platform;
  const executor = new CommandExecutor({ store, locks: base.locks, clock, platformFor });
  const ctx: JobContext = {
    store,
    clock,
    locks: base.locks,
    executor,
    platformFor,
    agent: base.agent,
    creatives: new TemplateCreativeEngine(),
    images: new TemplateImageEngine(),
    ...(base.agentCosts !== undefined && { agentCosts: base.agentCosts }),
    ...(base.strategist !== undefined && { strategist: base.strategist }),
  };
  return { record, business, clock, platform, ctx };
};

/** Saves the market and the virtual time. */
export const saveWorld = async (base: JobContext, world: SimulationWorld): Promise<void> => {
  world.record = { ...world.record, simNow: world.clock.now(), state: world.platform.snapshot() };
  await base.store.saveSimulation(world.record);
};

/** Loads a simulated business under its lock, runs `fn` and saves the world. */
export const withSimulation = <T>(base: JobContext, businessId: string, fn: (world: SimulationWorld) => Promise<T>): Promise<T> =>
  base.locks.withLock(simulationLockKey(businessId), async () => {
    const record = await base.store.getSimulation(businessId);
    if (!record) {
      throw new SimulationError("NOT_SIMULATED", `Business ${businessId} has no simulation`);
    }
    const world = simulationWorld(base, await base.store.getBusiness(businessId), record);
    const result = await fn(world);
    await saveWorld(base, world);
    return result;
  });

/** Milliseconds since the local midnight of `instant` in the time zone. */
const sinceLocalMidnight = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return ((part("hour") * 60 + part("minute")) * 60 + part("second")) * 1_000 + instant.getMilliseconds();
};

/** Local time of day a simulation starts at. */
const START_HOUR = 9;

/**
 * Virtual launch moment: 09:00 of the 1st of the next month, so the simulation's month is a calendar month with the
 * whole budget (simulation-mode spec «Режим бизнеса «Симуляция»»).
 */
const virtualStart = (realNow: Date, timeZone: string): Date => {
  const today = toLocalDate(realNow, timeZone);
  const shiftDays = daysBetween(today, simulationStartDate(today));
  const midnight = realNow.getTime() - sinceLocalMidnight(realNow, timeZone);
  return new Date(midnight + shiftDays * DAY_MS + START_HOUR * HOUR_MS);
};

const emptyState = (business: BusinessRecord, seed: number, at: Date): SimulatorState => newPlatform(business, seed, new ManualClock(at)).snapshot();

/**
 * Creates campaigns in the training market; used by «Запустить в симуляции» and by «Начать заново». The virtual time
 * then stands until the owner enters a period.
 */
const launchInWorld = async (base: JobContext, record: SimulationRecord): Promise<LaunchResult> => {
  await base.store.saveSimulation({ ...record, status: "paused" });
  return withSimulation(base, record.businessId, (world) => launchAds(world.ctx, record.businessId, record.plan));
};

const newRecord = (business: BusinessRecord, plan: LaunchPlan, start: Date): SimulationRecord => ({
  businessId: business.id,
  scenario: null,
  seed: OWNER_MARKET_SEED,
  plan,
  startedAt: start,
  simNow: start,
  endsAt: new Date(start.getTime() + STORED_RUN_DAYS * DAY_MS),
  // The time moves only by the owner's periods; the old tick fields stay empty.
  lastTickAt: null,
  speed: 0,
  status: "paused",
  state: emptyState(business, OWNER_MARKET_SEED, start),
  baseline: null,
  steps: [],
  replay: null,
});

/** «Запустить в симуляции» (simulation-mode spec): the business gets the training market on its first virtual day. */
export const launchSimulation = async (base: JobContext, businessId: string, plan: LaunchPlan): Promise<LaunchResult> => {
  const business = await base.store.getBusiness(businessId);
  const start = virtualStart(base.clock.now(), business.timeZone);
  const simulated: BusinessRecord = { ...business, mode: "simulation" };
  await base.store.saveBusiness(simulated);
  return launchInWorld(base, newRecord(simulated, plan, start));
};

/**
 * «Начать заново» (simulation-mode spec «Симуляция как отдельный режим»): the numbers and the history of the run are
 * deleted, and the advertising starts again from day 1 with the same ads.
 */
export const restartSimulation = async (base: JobContext, businessId: string): Promise<LaunchResult> => {
  const record = await base.store.getSimulation(businessId);
  if (!record) {
    throw new SimulationError("NOT_SIMULATED", `Business ${businessId} has no simulation`);
  }
  const business = { ...(await base.store.getBusiness(businessId)), launchedOn: null };
  const fresh = newRecord(business, record.plan, record.startedAt);
  await base.locks.withLock(simulationLockKey(businessId), async () => {
    await base.store.deleteLaunchData(businessId);
    await base.store.saveBusiness(business);
    await base.store.saveSimulation({ ...fresh, status: "paused" });
  });
  return launchInWorld(base, fresh);
};

/** The window «Добавить статистику» of a saved run, as the web shows and checks it before the worker checks again. */
export const savedPeriodForm = (record: SimulationRecord, directions: readonly DirectionRecord[], ads: readonly AdRecord[], timeZone: string): PeriodForm =>
  periodForm({
    state: record.state,
    room: (id, dates) => campaignRoom(record.state, id, dates),
    traffic: (id) => campaignTraffic(record.state, id),
    directions,
    ads,
    start: record.simNow,
    timeZone,
    last: lastEntered(record.steps),
  });

/**
 * «Новая кампания» (simulation-mode spec «Симуляция как отдельный режим»): the simulation's numbers, history and ads are
 * deleted with the business's card, budget and goal, and the wizard opens on its first step with an empty draft.
 */
export const startNewCampaign = async (base: JobContext, businessId: string): Promise<void> => {
  await base.locks.withLock(simulationLockKey(businessId), async () => {
    await base.store.deleteLaunchData(businessId);
    await base.store.deleteSimulation(businessId);
    await base.store.restartOnboarding(businessId);
  });
};

export type SimulationControl =
  /** `market` — marks a page from before market-leaks-live-review sends; they are not counted. */
  | { action: "period"; days: PeriodDays; ads: PeriodAdInput[]; market?: PeriodMarket }
  | { action: "continue" | "restart" | "new_campaign" };

/** Freeze the public inputs of the period, never the agent's private session or user data. */
const capturePeriodReport = async (world: SimulationWorld): Promise<string> => {
  const { store, clock } = world.ctx;
  const id = world.business.id;
  const today = toLocalDate(clock.now(), world.business.timeZone);
  const [view, stats, changes, insights, turns, hypotheses] = await Promise.all([
    loadBusinessView(store, id, clock, YANDEX_DIRECT_CAPABILITIES),
    store.stats(id, addDays(toLocalDate(world.record.startedAt, world.business.timeZone), -13), today), store.changes(id), store.insights(id), store.turnDigests(id), store.hypotheses(id),
  ]);
  const full = new Map<string, { date: string; spend: number; leads: number }>();
  const campaignIds = new Set(view.directions.map((d) => d.platformCampaignId));
  for (const cell of world.platform.snapshot().cells) {
    if (!campaignIds.has(cell.campaignId)) continue;
    const known = full.get(cell.date) ?? { date: cell.date, spend: 0, leads: 0 };
    known.spend += cell.spend; known.leads += cell.leads; full.set(cell.date, known);
  }
  // No control run and no scenario truth: the owner's numbers have neither (simulation-mode spec).
  const report: SimulationWeekReport = {
    version: 1, at: clock.now().toISOString(), cso: view.cso, monthlyBudgetRub: world.business.monthlyBudgetRub, endsAt: world.record.endsAt.toISOString(), baseline: null, stats,
    directions: view.directions, ads: view.ads,
    changes: changes.filter((c) => c.actor !== "budget_guard"), insights, turns, hypotheses,
    truths: [], fullDaily: [...full.values()],
  };
  return JSON.stringify(report);
};

/**
 * The service's one look at the end of a period, by the same jobs and in the same order as every morning on Direct,
 * with the period's review instead of the day's (simulation-on-owner-numbers decision 4). The hourly service does not
 * run in between, so no decision is taken inside the period.
 */
const lookAtPeriod = async (world: SimulationWorld, period: { from: LocalDate; to: LocalDate }): Promise<void> => {
  const { ctx, business } = world;
  await reconcile(ctx, business.id);
  await syncStats(ctx, business.id);
  await budgetGuard(ctx, business.id);
  await checkModerationAndBalance(ctx, business.id);
  await verifyBudget(ctx, business.id);
  await evaluateExperiments(ctx, business.id);
  await dailyEvaluation(ctx, business.id, { period });
  await adviseOnGoal(ctx, business.id);
  await recordOutcomes(ctx, business.id);
  await reconcileStats(ctx, business.id);
  await ctx.executor.recoverPending(5 * 60_000, (id) => id === business.id);
};

const markLast = (steps: SimulationStep[], patch: Partial<SimulationStep>): SimulationStep[] =>
  steps.map((s, i) => (i === steps.length - 1 ? { ...s, ...patch } : s));

/** The look of the last step: on failure the step is kept as failed, and «Продолжить расчёт» looks again. */
const finishStep = async (base: JobContext, businessId: string): Promise<void> => {
  await withSimulation(base, businessId, async (world) => {
    const step = world.record.steps.at(-1);
    if (step === undefined) return;
    const tz = world.business.timeZone;
    world.clock.set(step.to);
    // The period's days run from its first date to the day before the morning it ends on.
    const from = toLocalDate(step.from, tz);
    const last = addDays(toLocalDate(step.to, tz), -1);
    await lookAtPeriod(world, { from, to: last < from ? from : last });
    const report = await capturePeriodReport(world);
    world.record = { ...world.record, status: "paused", steps: markLast(world.record.steps, { state: "completed", completedAt: world.clock.now(), report }) };
  }).catch(async (error: unknown) => {
    // This is the job boundary. The numbers are saved; continuation is an explicit user action.
    if (error instanceof SimulationError && error.code === "NOT_SIMULATED") return;
    await base.locks.withLock(simulationLockKey(businessId), async () => {
      const saved = await base.store.getSimulation(businessId);
      if (saved === null) return;
      await base.store.saveSimulation({ ...saved, status: "paused", steps: markLast(saved.steps, { state: "failed", errorCode: "SIMULATION_STEP_FAILED" }) });
    });
    createLogger().error("Simulation period failed", { businessId, errorCode: "SIMULATION_STEP_FAILED" });
    throw error;
  });
};

/**
 * «Добавить статистику» (simulation-mode spec «Статистика периода от владельца»): the owner's numbers are checked
 * again against the advertising as it is now, recorded as Direct's stats of the period's days and saved with the step
 * in one hold of the lock; then the virtual clock jumps to the period's end and the service looks once.
 */
const livePeriod = async (base: JobContext, businessId: string, control: Extract<SimulationControl, { action: "period" }>): Promise<void> => {
  const started = await withSimulation(base, businessId, async (world) => {
    if (world.record.status === "stepping" || world.record.steps.at(-1)?.state === "failed") return false;
    const from = world.clock.now();
    const tz = world.business.timeZone;
    const [directions, ads] = await Promise.all([world.ctx.store.directions(businessId), world.ctx.store.ads(businessId)]);
    const state = world.platform.snapshot();
    const form = periodForm({
      state,
      room: (id, dates) => world.platform.roomOf(id, dates),
      traffic: (id) => campaignTraffic(state, id),
      directions,
      ads,
      start: from,
      timeZone: tz,
    });
    const check = checkPeriod(form, control.days, control.ads);
    if (check.changed || check.errors.length > 0) {
      throw new SimulationError(check.changed ? "ADS_CHANGED" : "PERIOD_INVALID", check.errors[0]?.message ?? "Period refused");
    }
    // The breakdown follows the training market's usual leaks and the negative phrases and adjustments in force now; marks
    // a page from before market-leaks-live-review sends are not counted.
    const market = MARKET;
    const directionOf = new Map(form.directions.flatMap((d) => d.ads.map((a) => [a.id, d] as const)));
    const platformAd = new Map(ads.map((a) => [a.id, a.platformAdId]));
    world.platform.recordPeriod(
      periodDates(from, control.days, tz),
      control.ads.map((a) => {
        const totals = { impressions: a.impressions, clicks: a.clicks, leads: a.leads, spend: a.spendRub * 100 };
        const direction = directionOf.get(a.adId);
        const segments = direction === undefined ? undefined : splitPeriod(direction, market, totals, { from: form.from, adId: a.adId });
        return { adId: platformAd.get(a.adId) ?? a.adId, ...totals, ...(segments !== undefined && { segments }) };
      }),
    );
    const traffic: Record<string, DirectionTraffic> = Object.fromEntries(
      form.directions.map((d) => [d.id, { keywords: d.keywords, negativeKeywords: d.negativeKeywords, deviceAdjustments: d.deviceAdjustments, junkQuery: d.junkQuery }]),
    );
    const to = new Date(from.getTime() + control.days * DAY_MS);
    world.record = {
      ...world.record,
      status: "stepping",
      steps: [...world.record.steps, { kind: "period", from, to, days: control.days, input: control.ads, market, traffic, recorded: true, state: "running" }],
    };
    return true;
  });
  if (started) await finishStep(base, businessId);
};

/** «Продолжить расчёт»: the failed period looks again with the numbers already recorded, never entered twice. */
const continueStep = async (base: JobContext, businessId: string): Promise<void> => {
  const resumed = await withSimulation(base, businessId, (world) => {
    if (world.record.steps.at(-1)?.state !== "failed") return Promise.resolve(false);
    world.record = { ...world.record, status: "stepping", steps: markLast(world.record.steps, { state: "running", errorCode: undefined }) };
    return Promise.resolve(true);
  });
  if (resumed) await finishStep(base, businessId);
};

/**
 * The player (simulation-mode spec «Симуляция как отдельный режим»); executed by the worker like any other change.
 * There is no «Запустить по-настоящему» (demo-login): the mode follows the login, and a demo has no real ads.
 */
export const controlSimulation = async (base: JobContext, businessId: string, control: SimulationControl): Promise<{ ok: true }> => {
  switch (control.action) {
    case "period":
      await livePeriod(base, businessId, control);
      break;
    case "continue":
      await continueStep(base, businessId);
      break;
    case "restart":
      await restartSimulation(base, businessId);
      break;
    case "new_campaign":
      await startNewCampaign(base, businessId);
      break;
  }
  return { ok: true };
};
