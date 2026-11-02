import { HeuristicPolicy, IdlePolicy, TemplateCreativeEngine } from "@impuls/agent";
import type { AgentRuntime, TurnResult, TurnSnapshot } from "@impuls/agent";
import { allowedWeeklyTotal, monthBudget, rubles, toLocalDate } from "@impuls/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualClock } from "./clock";
import type { JobContext } from "./context";
import { dispatchHour } from "./dispatcher";
import { deliverNotifications } from "./email";
import type { Mailer } from "./email";
import { CommandExecutor } from "./executor";
import type { LaunchPlan } from "./launch";
import { isAdDecision, isBudgetAdjustment } from "./change-kinds";
import { MemoryLockManager } from "./locks";
import { createLogger } from "./logger";
import { controlSimulation, launchSimulation, SIMULATION_SPEEDS, SimulationError, startSimulationTicker, tickSimulations } from "./simulation-mode";
import { SCENARIOS, scenarioStartDate } from "./scenarios";
import type { ScenarioId } from "./scenarios";
import { MemoryStore } from "./store";
import type { BusinessRecord } from "./store";
import { handleWebJob } from "./web-jobs";

const REAL_START = new Date("2026-10-30T07:00:00Z");
const logger = createLogger();

const plan = (searchAds = 2): LaunchPlan => ({
  landingUrl: "https://nogotok.example",
  city: "Москва",
  directions: [
    {
      name: "Маникюр — Поиск",
      channel: "search",
      weeklyLimitRub: 2_100,
      keywords: ["маникюр москва"],
      negativeKeywords: [],
      ads: Array.from({ length: searchAds }, (_, i) => ({ title: `Маникюр ${i + 1}`, text: "У метро, без очереди" })),
    },
    { name: "Маникюр — Сайты-партнёры", channel: "network", weeklyLimitRub: 1_400, keywords: [], negativeKeywords: [], ads: [{ title: "Ноготок — маникюр", text: "Запись онлайн" }] },
  ],
});

const business: BusinessRecord = {
  id: "b1",
  userId: "u1",
  timeZone: "Europe/Moscow",
  monthlyBudgetRub: 15_000,
  launchedOn: null,
  csoSource: { kind: "auto", reference: rubles(500) },
  miniSite: null,
  leadGoalId: null,
  mode: "direct",
  card: { category: "Маникюр", services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }], area: "", hours: "Пн–Вс 10:00–20:00", advantages: [], name: "Ноготок", address: "", city: "Москва", siteUrl: "https://nogotok.example" },
};

/** The worker's base context: real time is a manual clock, and the Direct platform must never be reached. */
const world = async (agent: AgentRuntime = new IdlePolicy()) => {
  const store = new MemoryStore();
  store.emails.set("b1", "owner@example.com");
  await store.saveBusiness(business);
  const clock = new ManualClock(REAL_START);
  const locks = new MemoryLockManager();
  const platformFor = () => {
    throw new Error("The Direct platform must not be used for a simulated business");
  };
  const ctx: JobContext = {
    store,
    clock,
    locks,
    executor: new CommandExecutor({ store, locks, clock, platformFor }),
    platformFor,
    agent,
    creatives: new TemplateCreativeEngine(),
  };
  return { store, clock, ctx };
};

const days = async (ctx: JobContext, n: number) => {
  for (let i = 0; i < n; i++) await controlSimulation(ctx, "b1", { action: "step_day" });
};

describe("simulation mode", () => {
  it("launches in the scenario's market without Direct and starts the virtual clock", async () => {
    const { store, ctx } = await world();
    const result = await launchSimulation(ctx, "b1", plan(), "dead_ad");
    expect(result.status).toBe("launched");
    expect((await store.getBusiness("b1")).mode).toBe("simulation");
    // A simulation always runs with the agent (add-agent-insights).
    expect(await store.getFlag("agent_enabled", "b1")).toBe(true);
    const record = await store.getSimulation("b1");
    expect(record).toMatchObject({ scenario: "dead_ad", status: "running", speed: SIMULATION_SPEEDS.fast });
    // A calendar month: 09:00 on the 1st of the next month, Moscow time.
    expect(record?.startedAt.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    // The control run is known from the start, day by day.
    expect(record?.baseline?.daily).toHaveLength(30);
    expect((await store.changes("b1")).map((c) => c.explanation)).toEqual(["Реклама запущена. Яндекс проверяет объявления, обычно это занимает несколько часов."]);
    const truths = new Map(record?.state.truths);
    const [first, second] = (await store.ads("b1")).filter((a) => a.title.startsWith("Маникюр ")).sort((a, b) => a.title.localeCompare(b.title));
    expect(truths.get(first?.platformAdId ?? "")?.cr).toBe(0);
    expect(truths.get(second?.platformAdId ?? "")?.cr).toBeGreaterThan(0);
  });

  it("refuses a scenario the plan does not fit, with the reason", async () => {
    const { ctx } = await world();
    await expect(launchSimulation(ctx, "b1", plan(1), "dead_ad")).rejects.toThrow(new SimulationError("SCENARIO_UNAVAILABLE", "Нужно хотя бы 2 объявления в поиске — сейчас 1"));
  });

  it("moves about a day every 10 seconds at the fast speed and is skipped by the hourly cron", async () => {
    const { store, clock, ctx } = await world();
    await launchSimulation(ctx, "b1", plan(), "regular");
    await controlSimulation(ctx, "b1", { action: "speed", speed: "fast" });
    for (let second = 0; second < 60; second++) {
      clock.set(new Date(clock.now().getTime() + 1_000));
      await tickSimulations(ctx, logger);
    }
    const record = await store.getSimulation("b1");
    const virtualDays = ((record?.simNow.getTime() ?? 0) - (record?.startedAt.getTime() ?? 0)) / 86_400_000;
    expect(virtualDays).toBeGreaterThanOrEqual(5);
    expect((await store.stats("b1", "2026-10-30", "2026-11-30")).length).toBeGreaterThan(0);
    // The real hourly dispatcher would throw on the Direct platform if it touched the simulated business.
    await dispatchHour(ctx);
  });

  it("stops at the next decision of the service", async () => {
    const { store, clock, ctx } = await world();
    await launchSimulation(ctx, "b1", plan(), "dead_ad");
    await controlSimulation(ctx, "b1", { action: "until_decision" });
    const from = (await store.getSimulation("b1"))?.simNow.getTime() ?? 0;
    let seconds = 0;
    for (; seconds < 600 && (await store.getSimulation("b1"))?.status !== "paused"; seconds++) {
      clock.set(new Date(clock.now().getTime() + 1_000));
      await tickSimulations(ctx, logger);
    }
    const record = await store.getSimulation("b1");
    expect(record?.status).toBe("paused");
    // Not paced by the real clock: 6 virtual hours every second, faster than «1 день = 10 секунд».
    expect(seconds).toBeLessThanOrEqual(Math.ceil(((record?.simNow.getTime() ?? 0) - from) / (6 * 3_600_000)) + 1);
    const changes = await store.changes("b1");
    // Budget-guard limit cuts came earlier and did not stop it: it stopped in the hour of the first decision about the ads.
    expect(changes.some(isBudgetAdjustment)).toBe(true);
    const decision = changes.find(isAdDecision);
    expect(decision).toBeDefined();
    expect((record?.simNow.getTime() ?? 0) - (decision?.createdAt.getTime() ?? 0)).toBeLessThanOrEqual(3_600_000);
  });

  it("starts a calendar month on the 1st, «Конец месяца» 4 days before a month ends", () => {
    expect(scenarioStartDate(SCENARIOS.regular, "2026-10-30")).toBe("2026-11-01");
    expect(scenarioStartDate(SCENARIOS.regular, "2026-12-15")).toBe("2027-01-01");
    expect(scenarioStartDate(SCENARIOS.month_end, "2026-10-10")).toBe("2026-10-28");
    expect(scenarioStartDate(SCENARIOS.month_end, "2026-10-30")).toBe("2026-11-27");
    // One scenario is offered first, and every scenario says what it shows.
    expect(Object.values(SCENARIOS).filter((s) => s.recommended).map((s) => s.title)).toEqual(["Обычный месяц"]);
    expect(Object.values(SCENARIOS).every((s) => s.shows.length > 0)).toBe(true);
  });

  it("tells decisions about the ads from budget-guard limit cuts", () => {
    expect(isAdDecision({ actor: "safety_net", author: "service", reasonCode: "SAFETY_PAUSE_AD" })).toBe(true);
    expect(isAdDecision({ actor: "safety_net", author: "service", reasonCode: "EXPERIMENT_VARIANT_WINS" })).toBe(true);
    expect(isAdDecision({ actor: "reconciliation", author: "cabinet", reasonCode: "CABINET_CHANGE" })).toBe(true);
    expect(isAdDecision({ actor: "budget_guard", author: "service", reasonCode: "BUDGET_FIT" })).toBe(false);
    expect(isAdDecision({ actor: "budget_guard", author: "service", reasonCode: "BUDGET_PAUSE_SHORTAGE" })).toBe(false);
    expect(isAdDecision({ actor: "user", author: "user", reasonCode: "USER_ROLLBACK" })).toBe(false);
    expect(isBudgetAdjustment({ actor: "budget_guard", reasonCode: "BUDGET_FIT" })).toBe(true);
    expect(isBudgetAdjustment({ actor: "budget_guard", reasonCode: "BUDGET_NEW_MONTH_LIMITS" })).toBe(false);
  });

  it("keeps the control run as the service keeps the budget, and it matches the totals", async () => {
    const { store, ctx } = await world();
    await launchSimulation(ctx, "b1", plan(), "regular");
    const baseline = (await store.getSimulation("b1"))?.baseline;
    expect(baseline?.daily.reduce((sum, d) => sum + d.spend, 0)).toBe(baseline?.spend);
    expect(baseline?.daily.reduce((sum, d) => sum + d.leads, 0)).toBe(baseline?.leads);
    // Never above the month budget: the same 90% rule as the service.
    expect(baseline?.spend).toBeLessThanOrEqual(15_000 * 100);
    await days(ctx, 30);
    expect((await store.getSimulation("b1"))?.baseline).toEqual(baseline);
  });

  it("repeats a run exactly after «Начать заново»", async () => {
    const { store, ctx } = await world();
    await launchSimulation(ctx, "b1", plan(), "regular");
    await days(ctx, 9);
    const first = { changes: (await store.changes("b1")).map((c) => [c.reasonCode, c.createdAt.toISOString()]), stats: await store.stats("b1", "2026-10-01", "2026-12-31") };
    await controlSimulation(ctx, "b1", { action: "restart" });
    await days(ctx, 9);
    expect((await store.changes("b1")).map((c) => [c.reasonCode, c.createdAt.toISOString()])).toEqual(first.changes);
    expect(await store.stats("b1", "2026-10-01", "2026-12-31")).toEqual(first.stats);
  });

  it("runs the owner's commands in the simulated market and in virtual time", async () => {
    const { store, ctx } = await world();
    await launchSimulation(ctx, "b1", plan(), "regular");
    await days(ctx, 3);
    const ad = (await store.ads("b1"))[0];
    await handleWebJob(ctx, { kind: "command", businessId: "b1", command: { type: "PauseAd", adId: ad?.id ?? "" }, explanation: "Вы отключили объявление." });
    const entry = (await store.changes("b1")).at(-1);
    const record = await store.getSimulation("b1");
    expect(entry).toMatchObject({ status: "applied", author: "user" });
    expect(entry?.createdAt.getTime()).toBe(record?.simNow.getTime());
    expect(record?.state.ads.find((a) => a.id === ad?.platformAdId)?.status).toBe("paused");
  });

  it("does not email the owner of a simulated business", async () => {
    const { store, ctx } = await world();
    await launchSimulation(ctx, "b1", plan(), "regular");
    await store.notify({ businessId: "b1", kind: "low_balance", message: "Пополните баланс", at: REAL_START });
    const sent: string[] = [];
    const mailer: Mailer = { send: (mail) => Promise.resolve(void sent.push(mail.to)) };
    await deliverNotifications(ctx, mailer, logger);
    expect(sent).toEqual([]);
    expect((await store.notifications("b1")).map((n) => n.message)).toContain("Пополните баланс");
  });

  it("ends after 30 days with the control run and returns to the wizard with «Запустить по-настоящему»", async () => {
    const { store, ctx } = await world();
    await launchSimulation(ctx, "b1", plan(), "regular");
    await days(ctx, 30);
    const record = await store.getSimulation("b1");
    expect(record?.status).toBe("paused");
    expect(record?.baseline?.days).toBe(30);
    expect(record?.baseline?.spend).toBeGreaterThan(0);

    await controlSimulation(ctx, "b1", { action: "go_real" });
    expect(await store.getSimulation("b1")).toBeNull();
    expect(await store.directions("b1")).toEqual([]);
    expect(await store.changes("b1")).toEqual([]);
    expect(await store.getBusiness("b1")).toMatchObject({ mode: "direct", launchedOn: null, card: business.card });
  });
});

describe("budget guard at the end of a month (found by the simulation)", () => {
  it("resumes a shortage pause on the 1st once, without pausing and resuming every hour", async () => {
    const { store, ctx } = await world();
    // «Конец месяца» starts 4 days before November ends with full-month limits: the remainder fits no minimum limit.
    await store.saveBusiness({ ...business });
    await launchSimulation(ctx, "b1", plan(), "month_end");
    await days(ctx, 6);
    const reasons = (await store.changes("b1")).map((c) => c.reasonCode);
    expect(reasons.filter((r) => r === "BUDGET_PAUSE_SHORTAGE").length).toBeGreaterThan(0);
    expect(reasons.filter((r) => r === "BUDGET_NEW_MONTH").length).toBe(1);
    expect((await store.directions("b1")).every((d) => d.status === "active")).toBe(true);
  });
});

describe("scenario outcomes on a 15 000 ₽ budget with a wizard-like plan (simulation-mode spec)", () => {
  /** Three ads per channel and launch-month limits, as the wizard builds them. */
  const outcome = async (scenario: string, start: string) => {
    const { store, clock, ctx } = await world();
    clock.set(new Date(start));
    // Limits for the virtual launch date, as the launch route builds the plan.
    const today = scenarioStartDate(SCENARIOS[scenario as ScenarioId], toLocalDate(clock.now(), "Europe/Moscow"));
    const total = Math.floor(allowedWeeklyTotal(0, monthBudget(15_000, today, today), today) / 100);
    const wizardPlan = plan(3);
    wizardPlan.directions = wizardPlan.directions.map((d) => ({
      ...d,
      weeklyLimitRub: d.channel === "search" ? Math.floor(total * 0.6) : total - Math.floor(total * 0.6),
      ads: [0, 1, 2].map((i) => ({ title: `${d.channel === "search" ? "Маникюр" : "Ноготок"} ${i + 1}`, text: "У метро" })),
    }));
    await launchSimulation(ctx, "b1", wizardPlan, scenario);
    await days(ctx, 30);
    const startedAt = (await store.getSimulation("b1"))?.startedAt.getTime() ?? 0;
    return (await store.changes("b1")).map((c) => ({ day: Math.floor((c.createdAt.getTime() - startedAt) / 86_400_000) + 1, reason: c.reasonCode }));
  };
  const firstDay = (events: { day: number; reason: string }[], pattern: RegExp) => events.find((e) => pattern.test(e.reason))?.day ?? Number.POSITIVE_INFINITY;

  it.each(["2026-10-30T07:00:00Z", "2026-11-03T07:00:00Z"])("launched %s", async (start) => {
    const dead = await outcome("dead_ad", start);
    expect(firstDay(dead, /^SAFETY_PAUSE_(AD|DIRECTION)$/)).toBeLessThanOrEqual(14);
    expect(firstDay(dead, /^SAFETY_SCALE_EFFECTIVE$/)).toBeLessThanOrEqual(14);
    expect(firstDay(await outcome("borderline", start), /^EXPERIMENT_/)).toBeLessThanOrEqual(30);
    expect(firstDay(await outcome("cabinet_edit", start), /^CABINET_CHANGE$/)).toBe(5);
  });
});

describe("owner's rollback in a simulation", () => {
  it("goes through the web job into the simulated world and is logged", async () => {
    // Every «больше денег» entry really raised a limit: a raise clamped to nothing is not logged (guard).
    const { store, ctx } = await world();
    await launchSimulation(ctx, "b1", plan(), "dead_ad");
    // A raise needs room in the month's budget, which opens up at the turn of a week.
    for (let day = 0; day < 30 && !(await store.changes("b1")).some((c) => c.reasonCode === "SAFETY_SCALE_EFFECTIVE"); day++) {
      await days(ctx, 1);
    }
    const scaled = (await store.changes("b1")).filter((c) => c.reasonCode === "SAFETY_SCALE_EFFECTIVE");
    expect(scaled.length).toBeGreaterThan(0);
    // A real raise, never a few rubles (optimization-engine spec «Остатка бюджета хватает на несколько рублей»).
    expect(scaled.every((c) => Number(c.after.weeklyLimit) >= Number(c.before.weeklyLimit) * 1.05)).toBe(true);
    expect(scaled.every((c) => Number(c.after.weeklyLimit) > Number(c.before.weeklyLimit))).toBe(true);
    const entry = scaled.at(-1);
    const result = await handleWebJob(ctx, { kind: "rollback", businessId: "b1", entryId: entry?.id ?? "" });
    expect(result).toMatchObject({ kind: "done" });
    expect((await store.changes("b1")).some((c) => c.reasonCode === "USER_ROLLBACK")).toBe(true);
    // The earlier limit is back in one step, budget-guard cuts after it stay as they were.
    const direction = (await store.directions("b1")).find((d) => d.id === entry?.objectId);
    expect(direction?.weeklyLimit).toBe(Number(entry?.before.weeklyLimit));
    expect((await store.changes("b1")).find((c) => c.id === entry?.id)?.revertedById).not.toBeNull();
  });
});

/** The deterministic agent, with every snapshot it was given kept for the checks. */
class SeeingPolicy extends HeuristicPolicy {
  readonly snapshots: TurnSnapshot[] = [];
  override runTurn(input: Parameters<HeuristicPolicy["runTurn"]>[0]): Promise<TurnResult> {
    this.snapshots.push(input.snapshot);
    return super.runTurn(input);
  }
}

/** Thinks about the «Маникюр» business until released, as a model turn of many seconds would. */
class SlowPolicy implements AgentRuntime {
  readonly name = "policy:slow";
  readonly instructionsVersion = "test";
  readonly decides = true;
  started = false;
  private release: () => void = () => undefined;
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  async runTurn(input: { snapshot: TurnSnapshot }): Promise<TurnResult> {
    if (input.snapshot.directions.some((d) => d.name.startsWith("Маникюр"))) {
      this.started = true;
      await this.gate;
    }
    return { summary: "Посмотрели рекламу.", calls: [], usage: null };
  }
  finish(): void {
    this.release();
  }
}

describe("simulation with the agent (add-agent-insights decision 8)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets the deployment's agent decide on virtual time without the scenario's truth", async () => {
    const agent = new SeeingPolicy();
    const { store, ctx } = await world(agent);
    await launchSimulation(ctx, "b1", plan(), "dead_ad");
    await days(ctx, 14);
    const record = await store.getSimulation("b1");
    const turns = await store.turns("b1");
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((t) => t.runtime === "policy:heuristic" && t.startedAt >= (record?.startedAt ?? new Date()))).toBe(true);
    expect((await store.insights("b1")).some((i) => i.source === "agent")).toBe(true);
    // The truth of the market (conversion, click rate, price of a click) stays in the simulated platform.
    const seen = JSON.stringify(agent.snapshots);
    expect(agent.snapshots.length).toBe(turns.length);
    expect(seen).not.toMatch(/"(cr|ctr|costPerClick|impressionsPerDay|truth)"/);
  });

  it("stands still while the agent thinks, and a slow turn of one simulation does not hold up another", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const agent = new SlowPolicy();
    const { store, clock, ctx } = await world(agent);
    await store.saveBusiness({ ...business, id: "b2" });
    const other = plan();
    other.directions = other.directions.map((d) => ({ ...d, name: d.name.replace("Маникюр", "Педикюр") }));
    await launchSimulation(ctx, "b1", plan(), "regular");
    await launchSimulation(ctx, "b2", other, "regular");
    const stop = startSimulationTicker(ctx, logger, 1_000);
    const second = async () => {
      clock.set(new Date(clock.now().getTime() + 1_000));
      await vi.advanceTimersByTimeAsync(1_000);
    };
    for (let i = 0; i < 60 && !agent.started; i++) await second();
    expect(agent.started).toBe(true);
    const thinking = (await store.getSimulation("b1"))?.simNow.getTime() ?? 0;
    const b2Before = (await store.getSimulation("b2"))?.simNow.getTime() ?? 0;
    // Thirty seconds of thinking: the first simulation stands, the second one goes on.
    for (let i = 0; i < 30; i++) await second();
    expect((await store.getSimulation("b1"))?.simNow.getTime()).toBe(thinking);
    expect(((await store.getSimulation("b2"))?.simNow.getTime() ?? 0) - b2Before).toBeGreaterThan(24 * 3_600_000);
    agent.finish();
    await vi.advanceTimersByTimeAsync(0);
    await second();
    stop();
    // The thirty seconds do not become virtual time: after the turn the first simulation goes on at its speed.
    const after = (await store.getSimulation("b1"))?.simNow.getTime() ?? 0;
    expect(after - thinking).toBeLessThanOrEqual(4 * 3_600_000);
  });

  it("applies «Пауза» pressed during «+1 день» right after the agent's turn, not at the end of the day", async () => {
    const agent = new SlowPolicy();
    const { store, ctx } = await world(agent);
    await launchSimulation(ctx, "b1", plan(), "regular");
    const startedAt = (await store.getSimulation("b1"))?.simNow.getTime() ?? 0;
    const step = controlSimulation(ctx, "b1", { action: "step_day" });
    for (let i = 0; i < 100 && !agent.started; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(agent.started).toBe(true);
    // The owner pauses while the agent thinks; the pause waits for the turn only.
    const pause = controlSimulation(ctx, "b1", { action: "pause" });
    agent.finish();
    await Promise.all([step, pause]);
    const record = await store.getSimulation("b1");
    expect(record?.status).toBe("paused");
    expect((record?.simNow.getTime() ?? 0) - startedAt).toBeLessThan(86_400_000);
    // Without a pause the step goes the whole day, through the agent's turns.
    await controlSimulation(ctx, "b1", { action: "step_day" });
    expect(((await store.getSimulation("b1"))?.simNow.getTime() ?? 0) - (record?.simNow.getTime() ?? 0)).toBe(86_400_000);
    expect((await store.getSimulation("b1"))?.status).toBe("paused");
  });

  it("repeats a run with a deterministic agent exactly after «Начать заново»", async () => {
    const { store, ctx } = await world(new HeuristicPolicy());
    await launchSimulation(ctx, "b1", plan(), "dead_ad");
    await days(ctx, 12);
    const run = async () => ({
      changes: (await store.changes("b1")).map((c) => [c.actor, c.reasonCode, c.createdAt.toISOString()]),
      insights: (await store.insights("b1")).map((i) => [i.source, i.reasonCode, i.observation, i.createdAt.toISOString()]),
    });
    const first = await run();
    expect(first.insights.some(([source]) => source === "agent")).toBe(true);
    await controlSimulation(ctx, "b1", { action: "restart" });
    await days(ctx, 12);
    expect(await run()).toEqual(first);
  });
});

describe("analyst levers in «Обычный месяц» (add-agent-analyst-stage1)", () => {
  it("lets the heuristic agent cut junk queries, lower the price per click from phones and review the week", async () => {
    const { store, ctx } = await world(new HeuristicPolicy());
    // The plan cuts the usual junk already, as the wizard's plans do; the scenario's junk is other words.
    const withNegatives = plan(1);
    const [search] = withNegatives.directions;
    if (search) search.negativeKeywords = ["бесплатно", "обучение", "фото"];
    await launchSimulation(ctx, "b1", withNegatives, "regular");
    await days(ctx, 14);
    const actions = (await store.changes("b1")).filter((c) => c.actor === "agent" && c.status === "applied").map((c) => c.action);
    expect(actions.filter((a) => a.type === "AddNegativeKeywords").map((a) => (a.type === "AddNegativeKeywords" ? a.phrases : [])).flat().sort()).toEqual(["идеи", "форум"]);
    expect(actions).toContainEqual(expect.objectContaining({ type: "SetDeviceAdjustment", device: "mobile", percent: -25 }));
    expect((await store.turns("b1")).filter((t) => t.trigger === "weekly_review").length).toBeGreaterThan(0);
    expect((await store.hypotheses("b1")).length).toBeGreaterThan(0);
  });
});
