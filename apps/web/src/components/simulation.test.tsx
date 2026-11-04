import { HeuristicPolicy, IdlePolicy, TemplateCreativeEngine } from "@impuls/agent";
import type { AgentRuntime } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { CommandExecutor, controlSimulation, launchSimulation, ManualClock, MemoryLockManager, MemoryStore, handleWebJob } from "@impuls/worker";
import type { JobContext, LaunchPlan } from "@impuls/worker";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HistoryItem } from "@/lib/history-view";
import { emptyDraft } from "@/lib/onboarding";
import { feedDays } from "@/lib/insights-model";
import { buildDecisionScreen, scenarioTruth } from "@/lib/simulation-screen";
import { buildServiceWork } from "@/lib/service-work";
import type { AdsWork } from "@/lib/server/simulation-screen";
import { buildWeekStory, livedWeeks } from "@/lib/week-story";
import { isCurrentAction, SimulationControlBody } from "@/lib/simulation-model";
import { AdsSheet } from "./summary/AdsSheet";
import { ComparisonNote } from "./summary/HistorySheet";
import { ModeChoice, ScenarioPicker } from "./wizard/SimulationChoice";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/summary" }));

const plan: LaunchPlan = {
  landingUrl: "https://nogotok.example",
  city: "Москва",
  directions: [
    { name: "Маникюр — Поиск", channel: "search", weeklyLimitRub: 2_100, keywords: ["маникюр"], negativeKeywords: [], ads: [1, 2, 3].map((i) => ({ title: `Маникюр ${i}`, text: "У метро" })) },
    { name: "Маникюр — Сайты-партнёры", channel: "network", weeklyLimitRub: 1_400, keywords: [], negativeKeywords: [], ads: [1, 2, 3].map((i) => ({ title: `Ноготок ${i}`, text: "Запись онлайн" })) },
  ],
};

/** A 30-day run of «Одно объявление не приносит клиентов» on the worker, in memory, with the rules or the agent. */
const run = async (rollBackOne: boolean, agent: AgentRuntime = new IdlePolicy()) => {
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
  const ctx: JobContext = { store, clock, locks, executor: new CommandExecutor({ store, locks, clock, platformFor }), platformFor, agent, creatives: new TemplateCreativeEngine() };
  await launchSimulation(ctx, "b1", plan, "dead_ad");
  // Four weeks and the last two days: 30 days in five steps, each with its week story.
  for (let week = 0; week < 5; week++) await controlSimulation(ctx, "b1", { action: "step_week" });
  if (rollBackOne) {
    // The owner changes the show hours and takes it back; the worker routes both into the simulated world.
    const direction = (await store.directions("b1"))[0];
    await handleWebJob(ctx, { kind: "command", businessId: "b1", command: { type: "UpdateSchedule", directionId: direction?.id ?? "", schedule: "Пн–Вс 10:00–21:00" }, explanation: "Вы изменили время показа." });
    const result = (await handleWebJob(ctx, { kind: "rollback", businessId: "b1", entryId: (await store.changes("b1")).at(-1)?.id ?? "" })) as { kind: string };
    expect(result.kind).toBe("done");
  }
  const simulation = await store.getSimulation("b1");
  if (!simulation) throw new Error("no simulation");
  const ads = await store.ads("b1");
  const truthOf = scenarioTruth({ simulation, ads, goal: rubles(500) });
  const model = buildDecisionScreen({ simulation, timeZone: "Europe/Moscow", monthlyBudgetRub: 15_000, directions: await store.directions("b1"), changes: await store.changes("b1") });
  const days = feedDays({ insights: await store.insights("b1"), turns: await store.turnDigests("b1"), timeZone: "Europe/Moscow", since: null, entries: new Map(), truthOf });
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
  const storyOf = async (week: number, overrides: Partial<Parameters<typeof buildWeekStory>[0]> = {}) =>
    buildWeekStory({
      simulation,
      week,
      timeZone: "Europe/Moscow",
      directions: await store.directions("b1"),
      ads,
      stats: await store.stats("b1", "2026-10-01", "2026-12-31"),
      cso: rubles(500),
      truthOf,
      reviews: days,
      history,
      changes,
      comparison: model.comparison,
      ...overrides,
    });
  const story = await storyOf(4);
  const directions = await store.directions("b1");
  const work = buildServiceWork({ ads, directions, stats: await store.stats("b1", "2026-12-01", "2026-12-30"), today: "2026-12-31", startedOn: "2026-12-01", timeZone: "Europe/Moscow", cso: rubles(500), reviews: days, history, changes, openChecks: (await store.hypotheses("b1")).filter((h) => h.status === "checking"), weeks: livedWeeks(simulation, "Europe/Moscow") });
  const screenModel: AdsWork = { ...work, site: "nogotok.example", history, names: { directions: {}, channels: {}, ads: {}, strategies: {} }, sim: { comparison: model.comparison, result: model.result, decisionDays: model.decisionDays, day: model.day, totalDays: model.totalDays, scenarioTitle: model.scenarioTitle, ended: model.result !== null, startedOn: "2026-12-01" } };
  return { ...model, work, screenModel, feed: { timeZone: "Europe/Moscow", check: null, days, names: { directions: {}, channels: {}, ads: {}, strategies: {} } }, ads, truthOf, story, storyOf };
};

describe("decisions screen model (simulation-mode spec)", () => {
  it("compares with the run without the service and ticks the checklist with history links", async () => {
    const model = await run(false);
    expect(model.day).toBe(30);
    // The scenario's items, the rollback and the budget; the cabinet item is not this scenario's and was not done.
    expect(model.checklist.map((c) => c.key)).toEqual(expect.arrayContaining(["pause", "scale", "rollback", "budget"]));
    expect(model.checklist.some((c) => c.key === "cabinet")).toBe(false);
    // With and without the service, day by day, for every day of the scenario.
    expect(model.comparison?.service).toHaveLength(30);
    expect(model.comparison?.baseline).toHaveLength(30);
    expect(model.comparison?.serviceNow.leads).toBe(model.result?.service.leads);
    expect(model.comparison?.baselineNow.leads).toBe(model.result?.baseline.leads);
    const item = (key: string) => model.checklist.find((c) => c.key === key);
    expect(item("pause")).toMatchObject({ done: true });
    expect(item("pause")?.entryId).toBeTruthy();
    expect(item("scale")).toMatchObject({ done: true });
    expect(item("budget")).toMatchObject({ done: true });
    expect(item("rollback")).toMatchObject({ done: false, hint: "Откатите любое изменение в истории или в ленте — кнопка «Вернуть как было»" });
    expect(model.decisionDays.length).toBeGreaterThan(0);
    expect(model.result?.days).toBe(30);
    expect(model.result?.service.spend).toBeGreaterThan(0);
  }, 60_000);

  it("ticks «откат работает» after the owner rolls a change back", async () => {
    const model = await run(true);
    expect(model.checklist.find((c) => c.key === "rollback")).toMatchObject({ done: true, hint: null });
  }, 60_000);

  it("says what is true about the insight's ad or advertising, against the goal", async () => {
    const model = await run(false);
    const dead = model.ads.find((a) => a.title === "Маникюр 1");
    expect(model.truthOf({ kind: "ad", id: dead?.id ?? "" })).toEqual({ text: "На самом деле: объявление не приводит обращений", tone: "danger" });
    const good = model.ads.find((a) => a.title === "Маникюр 2");
    expect(model.truthOf({ kind: "ad", id: good?.id ?? "" })?.text.replace(/\u00a0/g, " ")).toMatch(/^На самом деле: обращение примерно за \d[\d ]* ₽ — (в пределах|дороже) цели 500 ₽$/);
  }, 60_000);

  it("ticks the checklist by the agent's decisions too, and shows its insights with the truth", async () => {
    const model = await run(false, new HeuristicPolicy());
    expect(model.checklist.find((c) => c.key === "pause")).toMatchObject({ done: true });
    const insights = model.feed.days.flatMap((d) => d.insights);
    expect(insights.some((i) => i.author === "agent")).toBe(true);
    const pause = insights.find((i) => i.decision.text === "Отключили объявление «Маникюр 1»");
    expect(pause?.truth?.text).toBe("На самом деле: объявление не приводит обращений");
    // A change the guard refused is not tried again day after day.
    const refused = insights.filter((i) => i.decision.status === "rejected").map((i) => i.decision.text);
    expect(new Set(refused).size).toBe(refused.length);
    expect(model.feed.days.some((d) => d.summary !== null || d.quiet)).toBe(true);
  }, 60_000);

  it("says the comparison in one line, without a table, graphs or checklist", async () => {
    const model = await run(false, new HeuristicPolicy());
    if (!model.screenModel.sim) throw new Error("no simulation");
    render(<ComparisonNote sim={model.screenModel.sim} />);
    expect(screen.queryByTestId("sim-checklist")).toBeNull();
    const comparison = screen.getByTestId("sim-comparison");
    expect(comparison.querySelectorAll("table")).toHaveLength(0);
    expect(comparison).toHaveTextContent(`Итог 30 дней: с сервисом ${model.result?.service.leads ?? ""}`);
    expect(comparison).toHaveTextContent(`без него было бы ${model.result?.baseline.leads ?? ""}`);
    expect(document.querySelectorAll(".results-trend")).toHaveLength(0);
  }, 60_000);

});

describe("ads and journal of «Реклама» in a simulation (simulation-mode spec)", () => {
  it("shows the ads people see now and names the ones that are not shown", async () => {
    const model = await run(false, new HeuristicPolicy());
    // The agent paused the ad without clients; a new variant may share its title.
    const dead = model.ads.find((a) => a.title === "Маникюр 1" && a.status === "paused");
    expect(dead).toBeDefined();
    expect(model.work.hidden.map((h) => h.title)).toContain("Маникюр 1");
    expect(model.work.shown.some((a) => a.id === dead?.id)).toBe(false);
    expect(model.work.shown.length).toBeGreaterThan(0);
    render(<AdsSheet work={model.screenModel} onClose={vi.fn()} />);
    expect(screen.getAllByTestId("shown-ad")).toHaveLength(model.work.shown.length);
    expect(screen.getByTestId("hidden-ads")).toHaveTextContent("Маникюр 1");
  }, 60_000);

  it("keeps the agent's journal oldest first in sections of the lived weeks, with the change and the truth", async () => {
    const model = await run(false, new HeuristicPolicy());
    const entries = model.work.journal.flatMap((s) => s.entries);
    expect(entries.map((e) => e.date)).toEqual([...entries.map((e) => e.date)].sort());
    expect(model.work.journal.filter((s) => s.week !== null).map((s) => s.week)).toEqual([1, 2, 3, 4, 5]);
    // The launch day is before the calendar Monday: the week's header starts on that day, not on Monday.
    expect(model.work.journal[0]?.from).toBe(model.work.journal[0]?.entries[0]?.date ?? "");
    const pause = entries.find((e) => e.changes.some((c) => c.text === "Отключил объявление «Маникюр 1»"));
    expect(pause?.truths.map((t) => t.text)).toContain("На самом деле: объявление не приводит обращений");
    // Rejected proposals are never shown as changes.
    expect(entries.flatMap((e) => e.changes).every((c) => !c.text.startsWith("Изменение не применено"))).toBe(true);
    expect(entries.every((e) => e.paragraphs.every((p) => !p.includes("**") && !/^Разбор (дня|недели)/.test(p)))).toBe(true);
  }, 60_000);

  it("groups the ads by the rules' estimate and marks what the service changed", async () => {
    const model = await run(false, new HeuristicPolicy());
    const order = ["effective", "borderline", "learning", "ineffective"];
    const ranks = model.work.shown.map((a) => order.indexOf(a.verdict));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(model.work.journal[0]?.week).toBe(1);
    render(<AdsSheet work={model.screenModel} onClose={vi.fn()} />);
    for (const verdict of new Set(model.work.shown.map((a) => a.verdict))) expect(screen.getByTestId(`ads-${verdict}`)).toBeTruthy();
    const marks = [...model.work.shown.flatMap((a) => (a.change ? [a.change] : [])), ...model.work.directionChanges];
    expect(screen.queryAllByTestId("change-mark")).toHaveLength(marks.length);
    expect(marks.every((m) => !/направлени|инсайт/i.test(m.text))).toBe(true);
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

describe("week story (simulation-mode spec «История недели»)", () => {
  it("tells a week with a decision: the ads with the rules' estimate and the truth, the insights, the decision", async () => {
    const model = await run(false, new HeuristicPolicy());
    const weeks = await Promise.all([1, 2, 3, 4, 5].map((w) => model.storyOf(w)));
    const withDecision = weeks.find((w) => (w?.decisions.length ?? 0) > 0);
    expect(withDecision).toBeDefined();
    if (!withDecision) throw new Error("no week with a decision");
    expect(withDecision.days).toHaveLength(7);
    expect(withDecision.totals.spend).toBe(withDecision.days.reduce((sum, d) => sum + d.spend, 0));
    const dead = withDecision.rows.find((r) => r.title === "Маникюр 1");
    expect(dead?.truth?.text).toBe("На самом деле: объявление не приводит обращений");
    expect(withDecision.rows.every((r) => ["learning", "effective", "borderline", "ineffective"].includes(r.verdict))).toBe(true);
    expect(withDecision.noDecisionReason).toBeNull();
    // Opened again, the same week reads the same.
    expect(await model.storyOf(withDecision.week)).toEqual(withDecision);
    // The last step lived the scenario's last two days.
    expect(weeks[4]?.days).toHaveLength(2);
    expect(weeks[0]?.weeks.map((w) => w.week)).toEqual([1, 2, 3, 4, 5]);
  }, 60_000);

  it("says why nothing changed in a week without decisions", async () => {
    const model = await run(false, new HeuristicPolicy());
    // While the ads collect data, the rules' estimate says so.
    const collecting = await model.storyOf(1, { changes: [], stats: [] });
    // New reports stay frozen even if today's statistics and commands were corrected.
    expect(collecting).toEqual(await model.storyOf(1));
    expect(collecting?.savedAt).toBeDefined();
    // The first week's own decision comes on the morning after its seven days and belongs to it.
    const first = await model.storyOf(1);
    expect(first?.days.map((d) => d.date)).toEqual(["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06", "2026-12-07"]);
    expect(await model.storyOf(9)).toBeNull();
  }, 60_000);

});

describe("step 6 choice", () => {
  it("offers the simulation and explains why a scenario does not fit", () => {
    const onChange = vi.fn();
    render(<ModeChoice mode="direct" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Симуляция"));
    expect(onChange).toHaveBeenCalledWith("simulation");

    const draft = emptyDraft();
    draft.budget.monthlyBudgetRub = 15_000;
    draft.ads = { search: [{ title: "Маникюр", text: "У метро" }], network: [] };
    const onEdit = vi.fn();
    render(<ScenarioPicker draft={draft} scenario="regular" onChange={() => undefined} onEdit={onEdit} />);
    // «Обычный месяц» first, the others under «Другие сценарии».
    expect(screen.getByLabelText("Обычный месяц")).toBeChecked();
    expect(screen.queryByLabelText("Пограничное объявление")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Другие сценарии/ }));
    expect(screen.getByText("Нужно хотя бы 2 объявления в поиске — сейчас 1")).toBeTruthy();
    expect(screen.getByLabelText("Одно объявление не приносит клиентов")).toBeDisabled();
    expect(screen.getByLabelText("Пограничное объявление")).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Добавить объявление" }));
    expect(onEdit).toHaveBeenCalledWith(3);
  });
});

describe("pult actions", () => {
  it("accepts the steps and both kinds of restart, and tells the old pult's actions apart", () => {
    for (const body of [{ action: "step_week" }, { action: "step_day" }, { action: "restart", mode: "repeat" }, { action: "restart", mode: "fresh" }]) {
      const parsed = SimulationControlBody.parse(body);
      expect(isCurrentAction(parsed)).toBe(true);
    }
    for (const body of [{ action: "pause" }, { action: "until_decision" }, { action: "speed", speed: "fast" }]) {
      expect(isCurrentAction(SimulationControlBody.parse(body))).toBe(false);
    }
    expect(SimulationControlBody.safeParse({ action: "restart" }).success).toBe(false);
  });
});
