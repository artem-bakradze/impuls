import { TemplateCreativeEngine } from "@impuls/agent";
import type { AgentRuntime } from "@impuls/agent";
import { addDays, allowedWeeklyTotal, fitLimits, monthBudget, monthKey, toLocalDate } from "@impuls/core";
import type { Channel } from "@impuls/core";
import { SimulatedPlatform, YANDEX_DIRECT_CAPABILITIES } from "@impuls/platforms";
import type { SimulatorState } from "@impuls/platforms";
import { loadBusinessView } from "./state";
import { createLogger } from "./logger";
import type { SimulationWeekReport } from "./simulation-report";
import { ManualClock } from "./clock";
import type { Clock } from "./clock";
import type { JobContext } from "./context";
import { runBusinessHour } from "./dispatcher";
import { CommandExecutor } from "./executor";
import { launchAds } from "./launch";
import type { LaunchPlan, LaunchResult } from "./launch";
import { recordReplay, replayRuntime } from "./simulation-replay";
import { isScenarioId, launchTruth, planAds, SCENARIOS, scenarioStartDate, scenarioUnavailable } from "./scenarios";
import type { Scenario } from "./scenarios";
import type { BusinessRecord, SimulationBaseline, SimulationRecord, Store } from "./store";

/** A scenario runs 30 virtual days, then pauses with an offer to continue (simulation-mode spec). */
export const SIMULATION_DAYS = 30;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** «Прожить неделю» moves this many virtual days (simulation-mode spec «Виртуальное время и пульт»). */
export const WEEK_DAYS = 7;

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
  // «Повторить этот прогон»: both runtimes play the same recorded turns in order, until the run goes elsewhere.
  const replayed = (live: AgentRuntime): AgentRuntime =>
    record.replay === null
      ? live
      : replayRuntime({
          live,
          clock,
          store,
          businessId: business.id,
          record: () => world.record,
          update: (replay) => {
            world.record = { ...world.record, replay };
          },
        });
  world.ctx = {
    store,
    clock,
    locks: base.locks,
    executor,
    platformFor,
    agent: timedAgent(replayed(base.agent), base.clock, world),
    creatives: new TemplateCreativeEngine(),
    ...(base.agentCosts !== undefined && { agentCosts: base.agentCosts }),
    ...(base.strategist !== undefined && { strategist: { ...base.strategist, runtime: timedAgent(replayed(base.strategist.runtime), base.clock, world) } }),
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
 * Creates campaigns in the scenario's market; used by «Запустить в симуляции» and by «Начать заново». The virtual time
 * then stands until the owner steps it on the pult.
 */
const launchInWorld = async (base: JobContext, record: SimulationRecord): Promise<LaunchResult> => {
  await base.store.saveSimulation({ ...record, status: "paused" });
  return withSimulation(base, record.businessId, async (world) => {
    const result = await launchAds(world.ctx, record.businessId, record.plan);
    if (result.status === "launched") {
      await assignTruths(world, result.directionIds);
      // The control run does not depend on what the service or the owner will do, so it is known from the start.
      const baseline = await baselineRun(world.business, world.record, world.record.endsAt);
      world.record = { ...world.record, baseline };
    }
    return result;
  });
};

/** «Запустить в симуляции» (simulation-mode spec): the business gets the scenario's market on its first virtual day. */
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
  return launchInWorld(base, newRecord(simulated, scenario, plan, start));
};

const newRecord = (business: BusinessRecord, scenario: Scenario, plan: LaunchPlan, start: Date): SimulationRecord => ({
  businessId: business.id,
  scenario: scenario.id,
  seed: scenario.seed,
  plan,
  startedAt: start,
  simNow: start,
  endsAt: new Date(start.getTime() + SIMULATION_DAYS * DAY_MS),
  // The time moves only by steps on the pult; the old tick fields stay empty.
  lastTickAt: null,
  speed: 0,
  status: "paused",
  state: emptyState(business, scenario, scenario.seed, start),
  baseline: null,
  steps: [],
  replay: null,
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

/**
 * Moves the virtual clock hour by hour up to `target` (never past the end): scenario events, one hour of market
 * traffic, then the same per-business hour of the service as in the real mode. Returns the hours done and whether the
 * scenario's end was reached. With `yieldAfterTurn` it also returns after an hour in which a deciding agent took its
 * turn, so the pult shows the step's progress between the turns (add-agent-insights decision 8).
 */
export const advanceWorld = async (
  base: JobContext,
  world: SimulationWorld,
  target: Date,
  options: { yieldAfterTurn?: boolean } = {},
): Promise<{ hours: number; stopped: "end" | null }> => {
  const end = Math.min(target.getTime(), world.record.endsAt.getTime());
  const atEnd = () => world.clock.now().getTime() + HOUR_MS > world.record.endsAt.getTime();
  let hours = 0;
  while (world.clock.now().getTime() + HOUR_MS <= end) {
    const turnsBefore = world.agentTurns;
    const from = world.clock.now().getTime();
    const hourEnd = new Date(from + HOUR_MS);
    await applyEvents(world, from, hourEnd.getTime());
    world.clock.set(hourEnd);
    world.platform.advanceHour(hourEnd);
    try {
      await runBusinessHour(world.ctx, world.business);
      await world.ctx.executor.recoverPending(5 * 60_000, (id) => id === world.business.id);
    } catch (error: unknown) {
      // The market hour and any applied commands must survive a failed job boundary.
      // Pending commands are reconciled by the executor on continuation, never replayed here.
      await saveWorld(base, world);
      throw error;
    }
    await saveWorld(base, world);
    hours++;
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

/**
 * «Начать заново» (simulation-mode spec «Повтор прогона»): the same scenario from its first hour. «Повторить этот
 * прогон» keeps the run's turns and owner actions to replay them without the model; «Прогнать заново» lets the agent
 * decide again. A run without a turn on a model has nothing to replay and starts fresh.
 */
export const restartSimulation = async (base: JobContext, businessId: string, mode: "repeat" | "fresh" = "fresh"): Promise<LaunchResult> => {
  const record = await base.store.getSimulation(businessId);
  if (!record) {
    throw new SimulationError("NOT_SIMULATED", `Business ${businessId} has no simulation`);
  }
  const business = { ...(await base.store.getBusiness(businessId)), launchedOn: null };
  const replay =
    mode === "repeat"
      ? recordReplay(await base.store.turns(businessId), await base.store.changes(businessId), await base.store.directions(businessId), await base.store.ads(businessId))
      : null;
  const fresh = { ...newRecord(business, scenarioOf(record.scenario), record.plan, record.startedAt), replay };
  await base.locks.withLock(simulationLockKey(businessId), async () => {
    await base.store.deleteLaunchData(businessId);
    await base.store.saveBusiness(business);
    await base.store.saveSimulation({ ...fresh, status: "paused" });
  });
  return launchInWorld(base, fresh);
};

/** «Запустить по-настоящему»: the simulation's data is deleted, the wizard opens on its last step, «Объявления и запуск», with the draft kept. */
export const leaveSimulation = async (base: JobContext, businessId: string): Promise<void> => {
  await base.locks.withLock(simulationLockKey(businessId), async () => {
    await base.store.deleteLaunchData(businessId);
    await base.store.deleteSimulation(businessId);
    await base.store.reopenWizard(businessId, 3);
  });
};

export type SimulationControl =
  | { action: "step_week" | "step_day" | "extend" | "go_real" }
  | { action: "restart"; mode: "repeat" | "fresh" };

/** The control run covering the whole scenario; runs saved before it was kept by day get it computed once. */
const fullBaseline = async (world: SimulationWorld): Promise<SimulationBaseline> => {
  const days = Math.round((world.record.endsAt.getTime() - world.record.startedAt.getTime()) / DAY_MS);
  const known = world.record.baseline;
  return known !== null && Array.isArray(known.daily) && known.days === days ? known : baselineRun(world.business, world.record, world.record.endsAt);
};

/** Freeze the public inputs of the week, never the agent's private session or user data. */
const captureWeekReport = async (world: SimulationWorld): Promise<string> => {
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
  const report: SimulationWeekReport = {
    version: 1, at: clock.now().toISOString(), cso: view.cso, monthlyBudgetRub: world.business.monthlyBudgetRub, endsAt: world.record.endsAt.toISOString(), baseline: world.record.baseline, stats,
    directions: view.directions, ads: view.ads,
    changes: changes.filter((c) => c.actor !== "budget_guard"), insights, turns, hypotheses,
    truths: world.platform.snapshot().truths, fullDaily: [...full.values()],
  };
  return JSON.stringify(report);
};

/**
 * «Прожить неделю» and «+1 день» (simulation-mode spec «Виртуальное время и пульт»): the step's window is recorded
 * first, so the pult shows which day goes; then the time moves in parts that end after every agent turn, so the pult
 * follows the step. Meanwhile the simulation is `stepping`. The step runs to its end on the server even if the tab is
 * closed. The run has no end for the owner (simulation-mode spec «Симуляция как отдельный режим»): a step that goes past
 * the scenario's last day first extends the run by another scenario length, as «Продолжить ещё 30 дней» did, and then
 * runs whole.
 */
const step = async (base: JobContext, businessId: string, kind: "week" | "day"): Promise<void> => {
  const target = await withSimulation(base, businessId, async (world) => {
    const from = world.clock.now();
    if (world.record.status === "stepping") return null;
    const previous = world.record.steps.at(-1);
    if (previous?.state === "failed") {
      world.record = { ...world.record, status: "stepping", steps: world.record.steps.map((s, i) => i === world.record.steps.length - 1 ? { ...s, state: "running", errorCode: undefined } : s) };
      return previous.to;
    }
    const length = (kind === "week" ? WEEK_DAYS : 1) * DAY_MS;
    if (from.getTime() + length > world.record.endsAt.getTime()) {
      world.record = { ...world.record, endsAt: new Date(world.record.endsAt.getTime() + SIMULATION_DAYS * DAY_MS) };
      world.record = { ...world.record, baseline: await fullBaseline(world) };
      createLogger().info("Simulation run extended", { businessId, endsAt: world.record.endsAt.toISOString() });
    }
    const to = new Date(from.getTime() + length);
    // «Вы изменили ход прогона» has been on the pult since the last step: it is said once.
    const replay = world.record.replay?.diverged ? { ...world.record.replay, notified: true } : world.record.replay;
    world.record = { ...world.record, status: "stepping", steps: [...world.record.steps, { kind, from, to, state: "running" }], replay };
    return Promise.resolve(to);
  });
  if (target === null) return;
  for (;;) {
    const done = await withSimulation(base, businessId, async (world) => {
      const { stopped } = await advanceWorld(base, world, target, { yieldAfterTurn: true });
      if (world.clock.now().getTime() + HOUR_MS <= target.getTime() && stopped === null) return false;
      const current = world.record.steps.at(-1);
      const report = current?.kind === "week" ? await captureWeekReport(world) : undefined;
      const steps = world.record.steps.map((s, index) => (index === world.record.steps.length - 1 ? { ...s, to: world.clock.now(), state: "completed" as const, completedAt: world.clock.now(), ...(report !== undefined && { report }) } : s));
      world.record = { ...world.record, status: "paused", steps, ...(stopped === "end" && { baseline: await fullBaseline(world) }) };
      return true;
    }).catch(async (error: unknown) => {
      // This is the job boundary. Keep the checkpoint; continuation is an explicit user action.
      if (error instanceof SimulationError && error.code === "NOT_SIMULATED") return true;
      await base.locks.withLock(simulationLockKey(businessId), async () => {
        const saved = await base.store.getSimulation(businessId);
        if (saved === null) return;
        await base.store.saveSimulation({ ...saved, status: "paused", steps: saved.steps.map((s, i) => i === saved.steps.length - 1 ? { ...s, state: "failed", errorCode: "SIMULATION_STEP_FAILED" } : s) });
      });
      createLogger().error("Simulation step failed", { businessId, errorCode: "SIMULATION_STEP_FAILED" });
      throw error;
    });
    if (done) return;
  }
};

/** The pult (simulation-mode spec «Виртуальное время и пульт»); executed by the worker like any other change. */
export const controlSimulation = async (base: JobContext, businessId: string, control: SimulationControl): Promise<{ ok: true }> => {
  switch (control.action) {
    case "step_week":
      await step(base, businessId, "week");
      break;
    case "step_day":
      await step(base, businessId, "day");
      break;
    case "restart":
      await restartSimulation(base, businessId, control.mode);
      break;
    case "go_real":
      await leaveSimulation(base, businessId);
      break;
    case "extend":
      await withSimulation(base, businessId, async (world) => {
        world.record = { ...world.record, endsAt: new Date(world.record.endsAt.getTime() + SIMULATION_DAYS * DAY_MS) };
        world.record = { ...world.record, baseline: await fullBaseline(world) };
      });
      break;
  }
  return { ok: true };
};
