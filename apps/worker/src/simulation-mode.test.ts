import { HeuristicPolicy, IdlePolicy, TemplateCreativeEngine, TemplateImageEngine } from "@impuls/agent";
import type { AgentRuntime, TurnResult, TurnTrigger } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { describe, expect, it } from "vitest";
import { RULES_DAY_CODE } from "./change-kinds";
import { ManualClock } from "./clock";
import type { JobContext } from "./context";
import { dispatchHour } from "./dispatcher";
import { deliverNotifications } from "./email";
import type { Mailer } from "./email";
import { CommandExecutor } from "./executor";
import type { LaunchPlan } from "./launch";
import { MemoryLockManager } from "./locks";
import { createLogger } from "./logger";
import { controlSimulation, launchSimulation, SimulationError } from "./simulation-mode";
import type { PeriodDays } from "./simulation-period";
import { MemoryStore } from "./store";
import type { BusinessRecord } from "./store";
import { handleWebJob } from "./web-jobs";

const REAL_START = new Date("2026-10-30T07:00:00Z");
const DAY_MS = 86_400_000;
const logger = createLogger();

const plan = (): LaunchPlan => ({
  landingUrl: "https://nogotok.example",
  city: "Москва",
  directions: [
    {
      name: "Маникюр — Поиск",
      channel: "search",
      weeklyLimitRub: 2_100,
      keywords: ["маникюр москва"],
      negativeKeywords: [],
      ads: [
        { title: "Маникюр 1", text: "У метро, без очереди" },
        { title: "Маникюр 2", text: "У метро, без очереди" },
      ],
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

/** The deterministic agent, with the trigger of every turn kept for the checks. */
class TriggerLog extends HeuristicPolicy {
  readonly triggers: TurnTrigger[] = [];
  override runTurn(input: Parameters<HeuristicPolicy["runTurn"]>[0]): Promise<TurnResult> {
    if (input.trigger) this.triggers.push(input.trigger);
    return super.runTurn(input);
  }
}

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
    images: new TemplateImageEngine(),
  };
  return { store, clock, ctx };
};

type Numbers = { impressions: number; clicks: number; leads: number; spendRub: number };

/** One period of the owner's numbers, by ad title; ads not named get zeros. */
const enter = async (ctx: JobContext, store: MemoryStore, days: PeriodDays, rows: Record<string, Numbers> = {}) => {
  const ads = await store.ads("b1");
  // A variant of a check repeats its ad's title: the numbers go to the ad first launched with it.
  const firstByTitle = new Map<string, string>();
  for (const a of ads) if (!firstByTitle.has(a.title)) firstByTitle.set(a.title, a.id);
  const input = [...firstByTitle].flatMap(([title, adId]) => {
    const row = rows[title];
    return row === undefined ? [] : [{ adId, ...row }];
  });
  await controlSimulation(ctx, "b1", { action: "period", days, ads: input });
};

const totals = async (store: MemoryStore, title: string) => {
  const ad = (await store.ads("b1")).find((a) => a.title === title);
  const rows = (await store.stats("b1", "2026-10-01", "2026-12-31")).filter((r) => r.adId === ad?.platformAdId);
  return rows.reduce((s, r) => ({ impressions: s.impressions + r.impressions, clicks: s.clicks + r.clicks, leads: s.leads + r.leads, spend: s.spend + r.spend }), { impressions: 0, clicks: 0, leads: 0, spend: 0 });
};

describe("simulation on the owner's numbers", () => {
  it("launches on the training market without Direct, on the 1st of the next month, with no traffic of its own", async () => {
    const { store, ctx } = await world();
    const result = await launchSimulation(ctx, "b1", plan());
    expect(result.status).toBe("launched");
    expect((await store.getBusiness("b1")).mode).toBe("simulation");
    expect(await store.getFlag("agent_enabled", "b1")).toBe(true);
    const record = await store.getSimulation("b1");
    expect(record).toMatchObject({ scenario: null, status: "paused", steps: [], baseline: null, replay: null });
    // A calendar month: 09:00 on the 1st of the next month, Moscow time.
    expect(record?.startedAt.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(record?.state.truths).toEqual([]);
    expect(await store.stats("b1", "2026-10-01", "2026-12-31")).toEqual([]);
    expect((await store.changes("b1")).map((c) => c.explanation)).toEqual(["Реклама запущена. Яндекс проверяет объявления, обычно это занимает несколько часов."]);
    // The real hourly dispatcher would throw on the Direct platform if it touched the simulated business.
    await dispatchHour(ctx);
  });

  it("records a week of the owner's numbers as Direct's stats and reviews it with one period turn", async () => {
    const agent = new TriggerLog();
    const { store, ctx } = await world(agent);
    await launchSimulation(ctx, "b1", plan());
    await enter(ctx, store, 7, { "Маникюр 1": { impressions: 1_400, clicks: 70, leads: 0, spendRub: 1_530 }, "Маникюр 2": { impressions: 900, clicks: 40, leads: 4, spendRub: 520 } });
    expect(await totals(store, "Маникюр 1")).toEqual({ impressions: 1_400, clicks: 70, leads: 0, spend: 153_000 });
    expect(await totals(store, "Маникюр 2")).toEqual({ impressions: 900, clicks: 40, leads: 4, spend: 52_000 });
    const record = await store.getSimulation("b1");
    expect((record?.simNow.getTime() ?? 0) - (record?.startedAt.getTime() ?? 0)).toBe(7 * DAY_MS);
    expect(record?.status).toBe("paused");
    expect(record?.steps).toMatchObject([{ kind: "period", days: 7, recorded: true, state: "completed" }]);
    expect(record?.steps[0]?.report).toBeDefined();
    // One turn for the whole period, with the launch event joined to it.
    expect(agent.triggers).toEqual([{ kind: "period_review", from: "2026-11-01", to: "2026-11-07", reasons: expect.any(Array) as unknown, events: [{ kind: "launch" }] }]);
    expect(await store.pendingInbox("b1")).toEqual([]);
  });

  it("takes one turn for two weeks with a Monday inside, without daily or weekly reviews", async () => {
    const agent = new TriggerLog();
    const { store, ctx } = await world(agent);
    await launchSimulation(ctx, "b1", plan());
    await enter(ctx, store, 14, { "Маникюр 1": { impressions: 2_000, clicks: 100, leads: 3, spendRub: 2_000 } });
    expect((await store.turns("b1")).map((t) => t.trigger)).toEqual(["period_review"]);
    expect(agent.triggers.map((t) => t.kind)).toEqual(["period_review"]);
  });

  it("reviews a period even when the evaluation has no reasons", async () => {
    const agent = new TriggerLog();
    const { store, ctx } = await world(agent);
    await launchSimulation(ctx, "b1", plan());
    await enter(ctx, store, 1);
    await enter(ctx, store, 1);
    expect(agent.triggers.map((t) => t.kind)).toEqual(["period_review", "period_review"]);
    expect((await store.getSimulation("b1"))?.simNow.toISOString()).toBe("2026-11-03T06:00:00.000Z");
  });

  it("refuses numbers Direct would not send and an ad that is not shown, recording nothing", async () => {
    const { store, ctx } = await world();
    await launchSimulation(ctx, "b1", plan());
    await expect(enter(ctx, store, 7, { "Маникюр 1": { impressions: 50, clicks: 60, leads: 0, spendRub: 100 } })).rejects.toThrow(new SimulationError("PERIOD_INVALID", "Переходов не может быть больше, чем показов"));
    await expect(enter(ctx, store, 7, { "Маникюр 1": { impressions: 5_000, clicks: 300, leads: 0, spendRub: 5_000 } })).rejects.toThrow(/^Директ потратит на это направление не больше [\d\s]+₽ за 7 дней$/);
    const [first] = await store.ads("b1");
    await handleWebJob(ctx, { kind: "command", businessId: "b1", command: { type: "PauseAd", adId: first?.id ?? "" }, explanation: "Вы отключили объявление." });
    await expect(controlSimulation(ctx, "b1", { action: "period", days: 7, ads: [{ adId: first?.id ?? "", impressions: 10, clicks: 1, leads: 0, spendRub: 30 }] })).rejects.toMatchObject({ code: "ADS_CHANGED" });
    expect((await store.getSimulation("b1"))?.steps).toEqual([]);
    expect(await store.stats("b1", "2026-10-01", "2026-12-31")).toEqual([]);
  });

  it("lets the rules turn off an ad that spends without leads when the agent decides nothing", async () => {
    const { store, ctx } = await world();
    await launchSimulation(ctx, "b1", plan());
    await enter(ctx, store, 7, { "Маникюр 1": { impressions: 1_800, clicks: 90, leads: 0, spendRub: 1_700 }, "Маникюр 2": { impressions: 1_500, clicks: 50, leads: 5, spendRub: 500 } });
    const ads = await store.ads("b1");
    expect(ads.find((a) => a.title === "Маникюр 1")?.status).toBe("paused");
    expect(ads.find((a) => a.title === "Маникюр 2")?.status).toBe("active");
    expect((await store.insights("b1")).some((i) => i.reasonCode === RULES_DAY_CODE)).toBe(true);
  });

  it("continues a failed look without recording the numbers twice", async () => {
    const { store, ctx } = await world();
    await launchSimulation(ctx, "b1", plan());
    const original = store.saveEvaluation.bind(store);
    let fail = true;
    store.saveEvaluation = (evaluation) => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error("store is down"));
      }
      return original(evaluation);
    };
    await expect(enter(ctx, store, 3, { "Маникюр 1": { impressions: 300, clicks: 20, leads: 1, spendRub: 400 } })).rejects.toThrow("store is down");
    expect((await store.getSimulation("b1"))?.steps).toMatchObject([{ kind: "period", recorded: true, state: "failed", errorCode: "SIMULATION_STEP_FAILED" }]);
    // A new period waits for «Продолжить расчёт».
    await enter(ctx, store, 1, { "Маникюр 1": { impressions: 10, clicks: 1, leads: 0, spendRub: 30 } });
    expect((await store.getSimulation("b1"))?.steps).toHaveLength(1);
    await controlSimulation(ctx, "b1", { action: "continue" });
    expect((await store.getSimulation("b1"))?.steps).toMatchObject([{ state: "completed" }]);
    expect(await totals(store, "Маникюр 1")).toEqual({ impressions: 300, clicks: 20, leads: 1, spend: 40_000 });
  });

  it("starts again from day 1 with the same ads and no numbers after «Начать заново»", async () => {
    const { store, ctx } = await world();
    await launchSimulation(ctx, "b1", plan());
    await enter(ctx, store, 7, { "Маникюр 1": { impressions: 1_400, clicks: 70, leads: 2, spendRub: 1_200 } });
    await controlSimulation(ctx, "b1", { action: "restart" });
    const record = await store.getSimulation("b1");
    expect(record).toMatchObject({ scenario: null, steps: [], status: "paused" });
    expect(record?.simNow.getTime()).toBe(record?.startedAt.getTime());
    expect(await store.stats("b1", "2026-10-01", "2026-12-31")).toEqual([]);
    expect((await store.ads("b1")).map((a) => a.title).sort()).toEqual(["Маникюр 1", "Маникюр 2", "Ноготок — маникюр"].sort());
  });

  it("runs the owner's commands in the simulated market and in virtual time", async () => {
    const { store, ctx } = await world();
    await launchSimulation(ctx, "b1", plan());
    await enter(ctx, store, 3);
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
    await launchSimulation(ctx, "b1", plan());
    await store.notify({ businessId: "b1", kind: "low_balance", message: "Пополните баланс", at: REAL_START });
    const sent: string[] = [];
    const mailer: Mailer = { send: (mail) => Promise.resolve(void sent.push(mail.to)) };
    await deliverNotifications(ctx, mailer, logger);
    expect(sent).toEqual([]);
    expect((await store.notifications("b1")).map((n) => n.message)).toContain("Пополните баланс");
  });

  it("starts a new campaign from the wizard's first step, with nothing of the simulation or the old card left", async () => {
    const { store, ctx } = await world();
    await launchSimulation(ctx, "b1", plan());
    await enter(ctx, store, 7, { "Маникюр 1": { impressions: 1_400, clicks: 70, leads: 2, spendRub: 1_200 } });
    await controlSimulation(ctx, "b1", { action: "new_campaign" });
    expect(await store.getSimulation("b1")).toBeNull();
    expect(await store.directions("b1")).toEqual([]);
    expect(await store.changes("b1")).toEqual([]);
    expect(await store.stats("b1", "2026-10-01", "2026-12-31")).toEqual([]);
    expect(await store.getBusiness("b1")).toMatchObject({ mode: "direct", launchedOn: null, monthlyBudgetRub: 0, csoSource: { kind: "auto", reference: 0 }, card: {}, miniSite: null, timeZone: "Europe/Moscow" });
  });
});
