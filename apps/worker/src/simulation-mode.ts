import { TemplateCreativeEngine } from "@impuls/agent";
import type { AgentRuntime } from "@impuls/agent";
import { addDays, allowedWeeklyTotal, fitLimits, monthBudget, monthKey, toLocalDate } from "@impuls/core";
import type { Channel } from "@impuls/core";
import { SimulatedPlatform, YANDEX_DIRECT_CAPABILITIES } from "@impuls/platforms";
import type { SimulatorState } from "@impuls/platforms";
import { ManualClock } from "./clock";
import type { Clock } from "./clock";
import type { JobContext } from "./context";
import { runBusinessHour } from "./dispatcher";
import { CommandExecutor } from "./executor";
import { launchAds } from "./launch";
import type { LaunchPlan, LaunchResult } from "./launch";
import type { Logger } from "./logger";
import { isAdDecision } from "./change-kinds";
import { isScenarioId, launchTruth, planAds, SCENARIOS, scenarioStartDate, scenarioUnavailable } from "./scenarios";
import type { Scenario } from "./scenarios";
import type { BusinessRecord, SimulationBaseline, SimulationRecord, Store } from "./store";

/** A scenario runs 30 virtual days, then pauses with an offer to continue (simulation-mode spec). */
export const SIMULATION_DAYS = 30;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Virtual milliseconds per real millisecond: «1 день = 10 секунд», «1 день = 1 минута», «Реальное время». */
export const SIMULATION_SPEEDS = { fast: DAY_MS / 10_000, minute: DAY_MS / 60_000, real: 1 } as const;
export type SimulationSpeed = keyof typeof SIMULATION_SPEEDS;
export const speedName = (speed: number): SimulationSpeed =>
  (Object.entries(SIMULATION_SPEEDS).find(([, value]) => value === speed)?.[0] as SimulationSpeed | undefined) ?? "minute";

export class SimulationError extends Error {
  constructor(
    readonly code: "NOT_SIMULATED" | "SCENARIO_UNAVAILABLE" | "UNKNOWN_SCENARIO",
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
  scenario: Scenario;
  clock: ManualClock;
  platform: SimulatedPlatform;
  ctx: JobContext;
  /** Agent turns run since the world was loaded and the real time they took. */
  agentTurns: number;
  agentTurnMs: number;
}

const scenarioOf = (id: string): Scenario => {
  if (!isScenarioId(id)) {
    throw new SimulationError("UNKNOWN_SCENARIO", `Unknown scenario ${id}`);
  }
  return SCENARIOS[id];
};

const newPlatform = (business: BusinessRecord, scenario: Scenario, seed: number, clock: ManualClock): SimulatedPlatform =>
  new SimulatedPlatform({
    seed,
    timeZone: business.timeZone,
    now: () => clock.now(),
    // Ads created after launch are new A/B variants; launch ads get their truth by place in the plan.
    truthFor: () => scenario.variantTruth,
    idPrefix: `sim-${business.id}-`,
    // The rules work within Direct's strategy catalog and minimum limit, as in the real mode.
    capabilities: YANDEX_DIRECT_CAPABILITIES,
  });

/** The deployment's agent with its turns counted and timed on the real clock (add-agent-insights decision 8). */
const timedAgent = (agent: AgentRuntime, realClock: Clock, world: Pick<SimulationWorld, "agentTurns" | "agentTurnMs">): AgentRuntime => ({
  name: agent.name,
  instructionsVersion: agent.instructionsVersion,
  decides: agent.decides,
  runTurn: async (input) => {
    const started = realClock.now().getTime();
    try {
      return await agent.runTurn(input);
    } finally {
      world.agentTurns++;
      world.agentTurnMs += realClock.now().getTime() - started;
    }
  },
});

/**
 * Job context of a simulated business (add-simulation-mode decision 2, add-agent-insights decision 8): the same
 * store, handlers and agent as the real mode, its own clock and market, template A/B variants. The agent sees only
 * the service's data, never the scenario's truth, which lives in the simulated market.
 */
export const simulationWorld = (base: JobContext, business: BusinessRecord, record: SimulationRecord): SimulationWorld => {
  const scenario = scenarioOf(record.scenario);
  const clock = new ManualClock(record.simNow);
  const platform = newPlatform(business, scenario, record.seed, clock);
  platform.restore(record.state);
  const store = simulationStore(base.store);
  const platformFor = () => platform;
  const executor = new CommandExecutor({ store, locks: base.locks, clock, platformFor });
  const world = { record, business, scenario, clock, platform, agentTurns: 0, agentTurnMs: 0 } as SimulationWorld;
  world.ctx = {
    store,
    clock,
    locks: base.locks,
    executor,
    platformFor,
    agent: timedAgent(base.agent, base.clock, world),
    creatives: new TemplateCreativeEngine(),
    ...(base.agentCosts !== undefined && { agentCosts: base.agentCosts }),
    ...(base.strategist !== undefined && { strategist: { ...base.strategist, runtime: timedAgent(base.strategist.runtime, base.clock, world) } }),
  };
  return world;
};

/** Saves the market and the virtual time; called after every virtual hour so a restart loses at most one. */
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

/** Local time of day the calendar-month scenarios start at. */
const START_HOUR = 9;

/**
 * Virtual launch moment on `scenarioStartDate`: 09:00 for the calendar-month scenarios; «Конец месяца» keeps the real
 * time of day.
 */
const virtualStart = (scenario: Scenario, realNow: Date, timeZone: string): Date => {
  const today = toLocalDate(realNow, timeZone);
  const shiftDays = Math.round((Date.parse(`${scenarioStartDate(scenario, today)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  if (scenario.daysBeforeMonthEnd !== null) {
    return new Date(realNow.getTime() + shiftDays * DAY_MS);
  }
  const midnight = realNow.getTime() - sinceLocalMidnight(realNow, timeZone);
  return new Date(midnight + shiftDays * DAY_MS + START_HOUR * HOUR_MS);
};

const emptyState = (business: BusinessRecord, scenario: Scenario, seed: number, at: Date): SimulatorState =>
  newPlatform(business, scenario, seed, new ManualClock(at)).snapshot();

/** Gives every launched ad its scenario truth by channel and place in the plan (creation order of the simulator). */
const assignTruths = async (world: SimulationWorld, directionIds: readonly string[]): Promise<void> => {
  const directions = await world.ctx.store.directions(world.business.id);
  const counters: Record<Channel, number> = { search: 0, network: 0 };
  const numberOf = (id: string) => Number(id.slice(id.lastIndexOf("-") + 1));
  for (const id of directionIds) {
    const direction = directions.find((d) => d.id === id);
    if (!direction) continue;
    const ads = (await world.platform.getAds([direction.platformCampaignId])).sort((a, b) => numberOf(a.id) - numberOf(b.id));
    for (const ad of ads) {
      world.platform.setTruth(ad.id, launchTruth(world.scenario, direction.channel, counters[direction.channel]++, direction));
    }
  }
};

/**
 * Creates campaigns in the scenario's market; used by «Запустить в симуляции» and by «Начать заново». The record is
 * saved paused first, so the ticker never moves a market without campaigns; the clock starts after the launch.
 */
const launchInWorld = async (base: JobContext, record: SimulationRecord): Promise<LaunchResult> => {
  await base.store.saveSimulation({ ...record, status: "paused", lastTickAt: null });
  return withSimulation(base, record.businessId, async (world) => {
    const result = await launchAds(world.ctx, record.businessId, record.plan);
    if (result.status === "launched") {
      await assignTruths(world, result.directionIds);
      // The control run does not depend on what the service or the owner will do, so it is known from the start.
      const baseline = await baselineRun(world.business, world.record, world.record.endsAt);
      world.record = { ...world.record, status: "running", lastTickAt: base.clock.now(), baseline };
    }
    return result;
  });
};

/** «Запустить в симуляции» (simulation-mode spec): the business gets the scenario's market and starts its clock. */
export const launchSimulation = async (base: JobContext, businessId: string, plan: LaunchPlan, scenarioId: string): Promise<LaunchResult> => {
  const scenario = scenarioOf(scenarioId);
  const business = await base.store.getBusiness(businessId);
  const reason = scenarioUnavailable(scenario, planAds(plan), business.monthlyBudgetRub);
  if (reason !== null) {
    throw new SimulationError("SCENARIO_UNAVAILABLE", reason);
  }
  const realNow = base.clock.now();
  const start = virtualStart(scenario, realNow, business.timeZone);
  const simulated: BusinessRecord = { ...business, mode: "simulation" };
  await base.store.saveBusiness(simulated);
  return launchInWorld(base, newRecord(simulated, scenario, plan, start, realNow));
};

const newRecord = (business: BusinessRecord, scenario: Scenario, plan: LaunchPlan, start: Date, realNow: Date): SimulationRecord => ({
  businessId: business.id,
  scenario: scenario.id,
  seed: scenario.seed,
  plan,
  startedAt: start,
  simNow: start,
  endsAt: new Date(start.getTime() + SIMULATION_DAYS * DAY_MS),
  lastTickAt: realNow,
  // «1 день = 10 секунд»: a month in 5 minutes, as step 6 promises.
  speed: SIMULATION_SPEEDS.fast,
  status: "running",
  state: emptyState(business, scenario, scenario.seed, start),
  baseline: null,
});

/** Virtual moment of a scenario event: 11:00 of its day, counted from the launch. */
const eventAt = (record: SimulationRecord, day: number): number => record.startedAt.getTime() + (day - 1) * DAY_MS + 11 * HOUR_MS;

const applyEvents = async (world: SimulationWorld, from: number, to: number): Promise<void> => {
  for (const event of world.scenario.events) {
    const at = eventAt(world.record, event.day);
    if (at < from || at >= to) continue;
    const direction = (await world.ctx.store.directions(world.business.id)).find((d) => d.channel === event.channel && d.status === "active");
    if (direction) {
      world.platform.cabinetEditCampaign(direction.platformCampaignId, { status: "paused" });
    }
  }
};

/** Decisions about the ads (not budget-guard limit cuts, not the owner's changes): what «До следующего решения» waits for. */
const adDecisions = async (world: SimulationWorld): Promise<number> => (await world.ctx.store.changes(world.business.id)).filter(isAdDecision).length;

/**
 * Moves the virtual clock hour by hour up to `target` (never past the end): scenario events, one hour of market
 * traffic, then the same per-business hour of the service as in the real mode. Returns the hours done and why it
 * stopped early, if it did. With `yieldAfterTurn` it also returns after an hour in which a deciding agent took its
 * turn, so the pult shows the turn's insights and a pause takes effect right after it (add-agent-insights decision 8).
 */
export const advanceWorld = async (
  base: JobContext,
  world: SimulationWorld,
  target: Date,
  options: { untilDecision?: boolean; yieldAfterTurn?: boolean } = {},
): Promise<{ hours: number; stopped: "decision" | "end" | null }> => {
  const end = Math.min(target.getTime(), world.record.endsAt.getTime());
  const decisionsBefore = options.untilDecision ? await adDecisions(world) : 0;
  const atEnd = () => world.clock.now().getTime() + HOUR_MS > world.record.endsAt.getTime();
  let hours = 0;
  while (world.clock.now().getTime() + HOUR_MS <= end) {
    const turnsBefore = world.agentTurns;
    const from = world.clock.now().getTime();
    const hourEnd = new Date(from + HOUR_MS);
    await applyEvents(world, from, hourEnd.getTime());
    world.clock.set(hourEnd);
    world.platform.advanceHour(hourEnd);
    await runBusinessHour(world.ctx, world.business);
    await world.ctx.executor.recoverPending(5 * 60_000, (id) => id === world.business.id);
    await saveWorld(base, world);
    hours++;
    if (options.untilDecision && (await adDecisions(world)) > decisionsBefore) {
      return { hours, stopped: "decision" };
    }
    if (options.yieldAfterTurn && world.ctx.agent.decides && world.agentTurns > turnsBefore) {
      return { hours, stopped: atEnd() ? "end" : null };
    }
  }
  return { hours, stopped: atEnd() ? "end" : null };
};

/**
 * Control run «если бы сервис ничего не делал» (add-simulation-mode decisions 9 and 13): the same scenario, seed and
 * plan in a fresh market with no decisions about the ads. The budget is kept the same way the service keeps it, so
 * the comparison shows the effect of the decisions and not of a different budget rule: every hour the limits are cut
 * to what the month still allows by the statistics Direct shows, and on the 1st they go up to the new month's amount.
 */
export const baselineRun = async (business: BusinessRecord, record: SimulationRecord, until: Date): Promise<SimulationBaseline> => {
  const scenario = scenarioOf(record.scenario);
  const clock = new ManualClock(record.startedAt);
  const platform = newPlatform(business, scenario, record.seed, clock);
  const strategyId = YANDEX_DIRECT_CAPABILITIES.strategies[0]?.id ?? "";
  const campaignIds: string[] = [];
  const counters: Record<Channel, number> = { search: 0, network: 0 };
  for (const direction of record.plan.directions) {
    const campaign = await platform.createCampaign({
      name: direction.name,
      channel: direction.channel,
      weeklyLimit: direction.weeklyLimitRub * 100,
      strategyId,
      siteMonitoring: true,
      targeting: { city: record.plan.city, keywords: direction.keywords, negativeKeywords: direction.negativeKeywords },
      schedule: business.card.hours,
    });
    campaignIds.push(campaign.id);
    for (const ad of direction.ads) {
      const created = await platform.createAd({ campaignId: campaign.id, title: ad.title, text: ad.text, landingUrl: record.plan.landingUrl });
      platform.setTruth(created.id, launchTruth(scenario, direction.channel, counters[direction.channel]++, direction));
    }
  }
  const from = toLocalDate(record.startedAt, business.timeZone);
  const minLimit = YANDEX_DIRECT_CAPABILITIES.minWeeklyLimit;
  // Active campaigns and their limits; a campaign the budget could not fit waits for the next month.
  let limits = new Map(campaignIds.map((id, i) => [id, (record.plan.directions[i]?.weeklyLimitRub ?? 0) * 100]));
  const waiting = new Map<string, number>();
  let month = monthKey(from);
  const sum = (values: Map<string, number>) => [...values.values()].reduce((total, v) => total + v, 0);
  while (clock.now().getTime() + HOUR_MS <= until.getTime()) {
    const today = toLocalDate(clock.now(), business.timeZone);
    const monthStart = `${monthKey(today)}-01`;
    const seen = (await platform.getStats(campaignIds, monthStart > from ? monthStart : from, today)).reduce((total, r) => total + r.spend, 0);
    const allowed = allowedWeeklyTotal(seen, monthBudget(business.monthlyBudgetRub, from, today), today);
    let next = new Map(limits);
    if (monthKey(today) !== month) {
      month = monthKey(today);
      for (const [id, limit] of waiting) next.set(id, limit);
      waiting.clear();
      const total = sum(next);
      if (total > 0 && allowed > total) {
        next = new Map([...next].map(([id, limit]) => [id, Math.max(minLimit, Math.floor((allowed * limit) / total))]));
      }
    }
    if (sum(next) > allowed) {
      const fitted = fitLimits([...next].map(([directionId, weeklyLimit]) => ({ directionId, weeklyLimit, rank: 0 })), allowed, minLimit);
      for (const id of fitted.paused) waiting.set(id, next.get(id) ?? 0);
      next = fitted.limits;
    }
    for (const id of campaignIds) {
      const before = limits.get(id);
      const after = next.get(id);
      if (after === undefined && before !== undefined) await platform.updateCampaign(id, { status: "paused" });
      else if (after !== undefined && before === undefined) await platform.updateCampaign(id, { status: "active", weeklyLimit: after });
      else if (after !== undefined && after !== before) await platform.updateCampaign(id, { weeklyLimit: after });
    }
    limits = next;
    clock.set(new Date(clock.now().getTime() + HOUR_MS));
    platform.advanceHour(clock.now());
  }
  const days = Math.round((until.getTime() - record.startedAt.getTime()) / DAY_MS);
  // The same calendar days as the service's side of the comparison: the hours of the next date are not counted.
  const to = addDays(from, days - 1);
  // Far in the future: every delayed hour of stats is visible.
  clock.set(new Date(until.getTime() + 30 * DAY_MS));
  const rows = await platform.getStats(campaignIds, from, to);
  const daily = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { spend: platform.trueSpend(campaignIds, date, date), leads: rows.filter((r) => r.date === date).reduce((sum, r) => sum + r.leads, 0) };
  });
  return {
    days,
    spend: platform.trueSpend(campaignIds, from, to),
    leads: rows.reduce((sum, r) => sum + r.leads, 0),
    daily,
  };
};

/** «Начать заново»: the same scenario from its first hour; with the same owner actions the run repeats exactly. */
export const restartSimulation = async (base: JobContext, businessId: string): Promise<LaunchResult> => {
  const record = await base.store.getSimulation(businessId);
  if (!record) {
    throw new SimulationError("NOT_SIMULATED", `Business ${businessId} has no simulation`);
  }
  const business = { ...(await base.store.getBusiness(businessId)), launchedOn: null };
  const fresh = newRecord(business, scenarioOf(record.scenario), record.plan, record.startedAt, base.clock.now());
  await base.locks.withLock(simulationLockKey(businessId), async () => {
    await base.store.deleteLaunchData(businessId);
    await base.store.saveBusiness(business);
    await base.store.saveSimulation({ ...fresh, status: "paused", lastTickAt: null });
  });
  return launchInWorld(base, fresh);
};

/** «Запустить по-настоящему»: the simulation's data is deleted, the wizard opens on step 6 with the draft kept. */
export const leaveSimulation = async (base: JobContext, businessId: string): Promise<void> => {
  await base.locks.withLock(simulationLockKey(businessId), async () => {
    await base.store.deleteLaunchData(businessId);
    await base.store.deleteSimulation(businessId);
    await base.store.reopenWizard(businessId, 6);
  });
};

export type SimulationControl =
  | { action: "pause" | "resume" | "until_decision" | "step_day" | "extend" | "restart" | "go_real" }
  | { action: "speed"; speed: SimulationSpeed };

/** The control run covering the whole scenario; runs saved before it was kept by day get it computed once. */
const fullBaseline = async (world: SimulationWorld): Promise<SimulationBaseline> => {
  const days = Math.round((world.record.endsAt.getTime() - world.record.startedAt.getTime()) / DAY_MS);
  const known = world.record.baseline;
  return known !== null && Array.isArray(known.daily) && known.days === days ? known : baselineRun(world.business, world.record, world.record.endsAt);
};

const finishIfEnded = async (world: SimulationWorld, stopped: "decision" | "end" | null): Promise<void> => {
  if (stopped === "end") {
    world.record = { ...world.record, status: "paused", lastTickAt: null, baseline: await fullBaseline(world) };
  } else if (stopped === "decision") {
    world.record = { ...world.record, status: "paused", lastTickAt: null };
  }
};

/**
 * «+1 день»: one virtual day, moved in parts that end after every agent turn, so that «Пауза» or another action pressed
 * meanwhile takes effect right after the turn (add-agent-insights decision 8). Meanwhile the simulation is `stepping`,
 * and the ticker leaves it alone; any other action ends the step.
 */
const stepDay = async (base: JobContext, businessId: string): Promise<void> => {
  const target = await withSimulation(base, businessId, (world) => {
    if (world.clock.now().getTime() + HOUR_MS > world.record.endsAt.getTime()) return Promise.resolve(null);
    world.record = { ...world.record, status: "stepping", lastTickAt: null };
    return Promise.resolve(new Date(Math.min(world.clock.now().getTime() + DAY_MS, world.record.endsAt.getTime())));
  });
  if (target === null) return;
  for (;;) {
    const done = await withSimulation(base, businessId, async (world) => {
      if (world.record.status !== "stepping") return true;
      const { stopped } = await advanceWorld(base, world, target, { yieldAfterTurn: true });
      if (world.clock.now().getTime() + HOUR_MS <= target.getTime() && stopped === null) return false;
      world.record = { ...world.record, status: "paused", lastTickAt: null };
      await finishIfEnded(world, stopped);
      return true;
    }).catch((error: unknown) => {
      // «Запустить по-настоящему» deleted the simulation between the parts.
      if (error instanceof SimulationError && error.code === "NOT_SIMULATED") return true;
      throw error;
    });
    if (done) return;
  }
};

/** The pult (simulation-mode spec «Виртуальное время и пульт»); executed by the worker like any other change. */
export const controlSimulation = async (base: JobContext, businessId: string, control: SimulationControl): Promise<{ ok: true }> => {
  if (control.action === "step_day") {
    await stepDay(base, businessId);
    return { ok: true };
  }
  if (control.action === "restart") {
    await restartSimulation(base, businessId);
    return { ok: true };
  }
  if (control.action === "go_real") {
    await leaveSimulation(base, businessId);
    return { ok: true };
  }
  await withSimulation(base, businessId, async (world) => {
    const now = base.clock.now();
    const atEnd = world.clock.now().getTime() + HOUR_MS > world.record.endsAt.getTime();
    switch (control.action) {
      case "pause":
        world.record = { ...world.record, status: "paused", lastTickAt: null };
        break;
      case "resume":
      case "until_decision":
        if (!atEnd) {
          world.record = { ...world.record, status: control.action === "resume" ? "running" : "until_decision", lastTickAt: now };
        }
        break;
      case "speed":
        world.record = { ...world.record, speed: SIMULATION_SPEEDS[control.speed], lastTickAt: world.record.status === "paused" ? null : now };
        break;
      case "extend":
        world.record = { ...world.record, endsAt: new Date(world.record.endsAt.getTime() + SIMULATION_DAYS * DAY_MS) };
        world.record = { ...world.record, baseline: await fullBaseline(world) };
        break;
    }
  });
  return { ok: true };
};

/** At most this much virtual time per tick, so one simulation does not hold its lock for long. */
const MAX_HOURS_PER_TICK = 6;
/**
 * Simulations one worker moves at the same time (add-agent-insights decision 8): a tick holds up to three lock
 * connections (simulation, agent turn, business), so the lock pool of the worker is sized for this many.
 */
export const MAX_MOVING_SIMULATIONS = 3;

/** One tick of one simulation (add-simulation-mode decision 4): moves it by the real time elapsed. */
export const tickSimulation = async (base: JobContext, logger: Logger, businessId: string): Promise<void> => {
  const realNow = base.clock.now();
  await base.locks.tryWithLock(simulationLockKey(businessId), async () => {
    const record = await base.store.getSimulation(businessId);
    if (!record || record.status === "paused") return;
    const world = simulationWorld(base, await base.store.getBusiness(record.businessId), record);
    const untilDecision = record.status === "until_decision";
    const speed = record.speed;
    const last = record.lastTickAt ?? realNow;
    // «До следующего решения» is not paced by the real clock: the owner is waiting for the decision, so every tick
    // moves the most a tick may.
    const due = untilDecision ? Number.POSITIVE_INFINITY : record.simNow.getTime() + (realNow.getTime() - last.getTime()) * speed;
    const target = new Date(Math.min(due, record.simNow.getTime() + MAX_HOURS_PER_TICK * HOUR_MS));
    const { hours, stopped } = await advanceWorld(base, world, target, { untilDecision, yieldAfterTurn: true });
    // Real time is consumed only for the hours done, so a slow tick catches up later instead of skipping hours; the
    // time the agent thought is consumed as it is, so virtual time stands while it thinks.
    const lastTickAt = untilDecision ? base.clock.now() : new Date(last.getTime() + (hours * HOUR_MS) / speed + world.agentTurnMs);
    world.record = { ...world.record, lastTickAt };
    await finishIfEnded(world, stopped);
    await saveWorld(base, world);
    if (stopped !== null) {
      logger.info("Simulation paused", { businessId: record.businessId, reason: stopped, simNow: world.clock.now().toISOString() });
    }
  });
};

/** One tick of every moving simulation (up to the limit), all at the same time: a slow agent turn delays no other. */
export const tickSimulations = async (base: JobContext, logger: Logger): Promise<void> => {
  const moving = (await base.store.movingSimulations()).slice(0, MAX_MOVING_SIMULATIONS);
  await Promise.all(moving.map((m) => tickSimulation(base, logger, m.businessId)));
};

/**
 * Ticks the simulations every second in the worker, each on its own: a simulation's tick is not started again while
 * its previous one runs (an agent turn takes seconds), and the others go on meanwhile.
 */
export const startSimulationTicker = (base: JobContext, logger: Logger, everyMs = 1_000): (() => void) => {
  const busy = new Set<string>();
  let listing = false;
  const failed = (businessId: string | null) => (error: unknown) =>
    logger.error("Simulation tick failed", { businessId, error: error instanceof Error ? error.message : String(error) });
  const timer = setInterval(() => {
    if (listing) return;
    listing = true;
    void base.store
      .movingSimulations()
      .then((moving) => {
        for (const { businessId } of moving) {
          if (busy.has(businessId) || busy.size >= MAX_MOVING_SIMULATIONS) continue;
          busy.add(businessId);
          void tickSimulation(base, logger, businessId)
            .catch(failed(businessId))
            .finally(() => busy.delete(businessId));
        }
      })
      .catch(failed(null))
      .finally(() => {
        listing = false;
      });
  }, everyMs);
  return () => clearInterval(timer);
};
