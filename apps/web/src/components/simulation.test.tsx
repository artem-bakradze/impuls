import { HeuristicPolicy, IdlePolicy, TemplateCreativeEngine, TemplateImageEngine } from "@impuls/agent";
import type { AgentRuntime } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { campaignRoom, campaignTraffic } from "@impuls/platforms";
import { CommandExecutor, controlSimulation, launchSimulation, ManualClock, MemoryLockManager, MemoryStore, periodForm } from "@impuls/worker";
import type { JobContext, LaunchPlan, PeriodAdInput } from "@impuls/worker";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HistoryItem } from "@/lib/history-view";
import { feedDays } from "@/lib/insights-model";
import { buildServiceWork } from "@/lib/service-work";
import type { AdsWork } from "@/lib/server/simulation-screen";
import { livedPeriods } from "@/lib/lived-periods";
import { currentAction, SimulationControlBody } from "@/lib/simulation-model";
import { AdsSheet } from "./summary/AdsSheet";
import { HistorySheet } from "./summary/HistorySheet";
import { DayWordsContext } from "./ui/DayWordsContext";
import { simulationWords } from "@/lib/day-words";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/summary" }));

const plan: LaunchPlan = {
  landingUrl: "https://nogotok.example",
  city: "Москва",
  directions: [
    { name: "Маникюр — Поиск", channel: "search", weeklyLimitRub: 2_100, keywords: ["маникюр"], negativeKeywords: [], ads: [1, 2, 3].map((i) => ({ title: `Маникюр ${i}`, text: "У метро" })) },
    { name: "Маникюр — Сайты-партнёры", channel: "network", weeklyLimitRub: 1_400, keywords: [], negativeKeywords: [], ads: [1, 2, 3].map((i) => ({ title: `Ноготок ${i}`, text: "Запись онлайн" })) },
  ],
};

/**
 * What the owner enters for a week: «Маникюр 1» spends without leads, «Маникюр 2» and «Ноготок 1» bring them cheaply,
 * every amount a share of what Direct would let the direction spend now.
 */
const weekOf = (form: ReturnType<typeof periodForm>): PeriodAdInput[] =>
  form.directions.flatMap((d) => {
    const room = d.roomRub[7];
    const first = (title: string) => d.ads.find((a) => a.title === title)?.id;
    const rows: PeriodAdInput[] = [];
    const add = (title: string, share: number, clicks: number, leads: number) => {
      const adId = first(title);
      const spendRub = Math.floor(room * share);
      if (adId !== undefined && spendRub > 0) rows.push({ adId, impressions: clicks * 20, clicks, leads, spendRub });
    };
    add("Маникюр 1", 0.6, 40, 0);
    add("Маникюр 2", 0.3, 30, 4);
    add("Ноготок 1", 0.5, 20, 2);
    return rows;
  });

/** Four weeks of the owner's numbers on the worker, in memory, with the rules or the agent. */
const run = async (agent: AgentRuntime = new IdlePolicy()) => {
  const store = new MemoryStore();
  await store.saveBusiness({
    id: "b1",
    userId: "u1",
    timeZone: "Europe/Moscow",
    monthlyBudgetRub: 15_000,
    launchedOn: null,
    csoSource: { kind: "auto", reference: rubles(500) },
    miniSite: null,
    leadGoalId: null,
    mode: "direct",
    card: { category: "Маникюр", services: [], area: "", hours: "Пн–Вс 10:00–20:00", advantages: [], name: "", address: "", city: "Москва", siteUrl: "https://nogotok.example" },
  });
  const clock = new ManualClock(new Date("2026-11-03T07:00:00Z"));
  const locks = new MemoryLockManager();
  const platformFor = () => {
    throw new Error("no Direct in a simulation");
  };
  const ctx: JobContext = { store, clock, locks, executor: new CommandExecutor({ store, locks, clock, platformFor }), platformFor, agent, creatives: new TemplateCreativeEngine(), images: new TemplateImageEngine() };
  await launchSimulation(ctx, "b1", plan);
  for (let week = 0; week < 4; week++) {
    const simulation = await store.getSimulation("b1");
    if (!simulation) throw new Error("no simulation");
    const form = periodForm({ state: simulation.state, room: (id, dates) => campaignRoom(simulation.state, id, dates), traffic: (id) => campaignTraffic(simulation.state, id), directions: await store.directions("b1"), ads: await store.ads("b1"), start: simulation.simNow, timeZone: "Europe/Moscow" });
    await controlSimulation(ctx, "b1", { action: "period", days: 7, ads: weekOf(form) });
  }
  const simulation = await store.getSimulation("b1");
  if (!simulation) throw new Error("no simulation");
  const ads = await store.ads("b1");
  const days = feedDays({ insights: await store.insights("b1"), turns: await store.turnDigests("b1"), timeZone: "Europe/Moscow", since: null, entries: new Map() });
  const changes = await store.changes("b1");
  const history: HistoryItem[] = changes.map((c) => ({
    id: c.id,
    at: c.createdAt.toISOString(),
    author: c.author,
    object: c.objectKind === "ad" ? "Объявление" : "Реклама",
    diff: [],
    explanation: c.explanation,
    outcome: null,
    turnId: c.turnId,
    insight: null,
    status: c.status,
    reverted: c.revertedById !== null,
    rollback: { kind: "available", consequences: [] },
    budgetAdjustment: false,
  }));
  const directions = await store.directions("b1");
  const work = buildServiceWork({
    ads,
    directions,
    stats: await store.stats("b1", "2026-12-01", "2026-12-31"),
    today: "2026-12-29",
    startedOn: "2026-12-01",
    timeZone: "Europe/Moscow",
    cso: rubles(500),
    reviews: days,
    history,
    changes,
    openChecks: (await store.hypotheses("b1")).filter((h) => h.status === "checking"),
    weeks: livedPeriods(simulation, "Europe/Moscow"),
  });
  const screenModel: AdsWork = { ...work, site: "nogotok.example", history, names: { directions: {}, channels: {}, ads: {}, strategies: {} }, sim: { startedOn: "2026-12-01" } };
  return { simulation, work, screenModel, ads, days, store };
};

describe("ads and history of «Реклама» on the owner's numbers (simulation-mode spec)", () => {
  it("lives the owner's periods with one review each, and the agent turns off the ad without leads", async () => {
    const model = await run(new HeuristicPolicy());
    expect(model.simulation.steps.map((s) => [s.kind, s.days, s.state])).toEqual([
      ["period", 7, "completed"],
      ["period", 7, "completed"],
      ["period", 7, "completed"],
      ["period", 7, "completed"],
    ]);
    expect((await model.store.turns("b1")).map((t) => t.trigger)).toEqual(["period_review", "period_review", "period_review", "period_review"]);
    expect(model.ads.some((a) => a.title === "Маникюр 1" && a.status === "paused")).toBe(true);
  }, 60_000);

  it("shows the ads people see now and names the ones that are not shown", async () => {
    const model = await run(new HeuristicPolicy());
    const dead = model.ads.find((a) => a.title === "Маникюр 1" && a.status === "paused");
    expect(model.work.hidden.map((h) => h.title)).toContain("Маникюр 1");
    expect(model.work.shown.some((a) => a.id === dead?.id)).toBe(false);
    render(<AdsSheet work={model.screenModel} onClose={vi.fn()} />);
    expect(screen.getAllByTestId("shown-ad")).toHaveLength(model.work.shown.length);
    expect(screen.getByTestId("hidden-ads")).toHaveTextContent("Маникюр 1");
  }, 60_000);

  it("keeps the history in sections of the lived periods, each with its review, and no comparison or truth", async () => {
    const model = await run(new HeuristicPolicy());
    const entries = model.work.journal.flatMap((s) => s.entries);
    expect(entries.map((e) => e.date)).toEqual([...entries.map((e) => e.date)].sort());
    const periods = model.work.journal.filter((s) => s.period);
    expect(periods.map((s) => [s.from, s.to])).toEqual([
      ["2026-12-01", "2026-12-07"],
      ["2026-12-08", "2026-12-14"],
      ["2026-12-15", "2026-12-21"],
      ["2026-12-22", "2026-12-28"],
    ]);
    // Every period's review names its days.
    expect(periods.map((s) => s.entries.find((e) => e.period !== undefined)?.period)).toEqual(periods.map((s) => ({ from: s.from, to: s.to })));
    expect(entries.every((e) => e.truths.length === 0)).toBe(true);
    render(
      <DayWordsContext.Provider value={simulationWords("2026-12-01")}>
        <HistorySheet work={model.screenModel} clientCost={{ kind: "unknown", costPerLead: null, hint: "", week: "2026-12-21" }} onClose={vi.fn()} onRollback={vi.fn()} />
      </DayWordsContext.Provider>,
    );
    expect(screen.getAllByTestId("journal-week").map((h) => h.textContent?.replace(/ /g, " "))).toEqual([
      "Дни 22–28 · разбор в день 29",
      "Дни 15–21 · разбор в день 22",
      "Дни 8–14 · разбор в день 15",
      "Дни 1–7 · разбор в день 8",
    ]);
    expect(screen.queryByTestId("sim-comparison")).toBeNull();
    expect(screen.queryByTestId("insight-truth")).toBeNull();
    expect(document.body.textContent).not.toMatch(/без него было бы|На самом деле/);
  }, 60_000);

  it("speaks plainly: no «инсайт», and «пункты» are percents", async () => {
    const { speech } = await import("@/lib/service-work");
    expect(speech("**Разбор дня:** сохранил инсайт. Повышаю цену перехода на 10 пунктов.")).toEqual(["Сохранил наблюдение. Повышаю цену перехода на 10%."]);
  });

  it("says hypotheses once, when they are opened", () => {
    const hypothesis = { id: "h1", statement: "телефоны приводят обращения дороже компьютеров", check: "Сравню цену обращения", checkOn: "2026-12-15", outcome: null, result: null };
    const weekly = (date: string) => ({ date, from: null, summary: "**Разбор недели:** снизил цену перехода с телефонов.", quiet: false, rulesReason: null, insights: [], weekly: { summary: "**Разбор недели:** снизил цену перехода с телефонов.", checking: [hypothesis], found: [], insights: [] } });
    const work = buildServiceWork({ ads: [], directions: [], stats: [], today: "2026-12-16", startedOn: "2026-12-01", timeZone: "Europe/Moscow", cso: rubles(500), reviews: [weekly("2026-12-15"), weekly("2026-12-08")], history: [], changes: [], openChecks: [], weeks: [] });
    const entries = work.journal.flatMap((s) => s.entries).filter((e) => e.weekly);
    expect(entries.map((e) => e.checking.length)).toEqual([1, 0]);
    // Without changes the first sentence is the gist.
    expect(entries[0]?.headline).toBe("Снизил цену перехода с телефонов.");
    expect(entries[0]?.paragraphs).toEqual([]);
  });
});

describe("player actions", () => {
  it("accepts a period, «Продолжить расчёт» and «Начать заново», and tells the older players' actions apart", () => {
    const period = { action: "period", days: 7, ads: [{ adId: "a1", impressions: 10, clicks: 1, leads: 0, spendRub: 30 }] };
    expect(currentAction(SimulationControlBody.parse(period))).toEqual(period);
    expect(currentAction(SimulationControlBody.parse({ action: "continue" }))).toEqual({ action: "continue" });
    expect(currentAction(SimulationControlBody.parse({ action: "restart" }))).toEqual({ action: "restart" });
    // «Прогнать заново» of the older player is today's «Начать заново»; its «Повторить этот прогон» is gone.
    expect(currentAction(SimulationControlBody.parse({ action: "restart", mode: "fresh" }))).toEqual({ action: "restart" });
    expect(currentAction(SimulationControlBody.parse({ action: "restart", mode: "repeat" }))).toBeNull();
    // «Запустить по-настоящему» is gone too: the mode follows the login (demo-login).
    for (const body of [{ action: "step_week" }, { action: "step_day" }, { action: "extend" }, { action: "pause" }, { action: "speed", speed: "fast" }, { action: "go_real" }]) {
      expect(currentAction(SimulationControlBody.parse(body))).toBeNull();
    }
    expect(SimulationControlBody.safeParse({ action: "period", days: 5, ads: [] }).success).toBe(false);
    expect(SimulationControlBody.safeParse({ action: "period", days: 7, ads: [{ adId: "a1", impressions: -1, clicks: 0, leads: 0, spendRub: 0 }] }).success).toBe(false);
  });

  it("takes a period's marks, and a period without them from an older page (simulation-breakdowns)", () => {
    const ads = [{ adId: "a1", impressions: 10, clicks: 1, leads: 0, spendRub: 30 }];
    const marked = { action: "period", days: 7, ads, market: { junkQuery: true, phonesWorse: false } };
    expect(currentAction(SimulationControlBody.parse(marked))).toEqual(marked);
    expect(currentAction(SimulationControlBody.parse({ action: "period", days: 7, ads }))).toEqual({ action: "period", days: 7, ads });
    expect(SimulationControlBody.safeParse({ ...marked, market: { junkQuery: true, phonesWorse: false, nightsEmpty: true } }).success).toBe(false);
    expect(SimulationControlBody.safeParse({ ...marked, market: { junkQuery: "yes", phonesWorse: false } }).success).toBe(false);
  });
});
