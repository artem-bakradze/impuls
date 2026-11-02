import { HeuristicPolicy, IdlePolicy, TemplateCreativeEngine } from "@impuls/agent";
import type { AgentRuntime } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { CommandExecutor, controlSimulation, launchSimulation, ManualClock, MemoryLockManager, MemoryStore, handleWebJob } from "@impuls/worker";
import type { JobContext, LaunchPlan } from "@impuls/worker";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatRub } from "@/lib/format";
import type { HistoryItem } from "@/lib/history-view";
import { emptyDraft } from "@/lib/onboarding";
import { feedDays } from "@/lib/insights-model";
import { buildDecisionScreen, scenarioTruth } from "@/lib/simulation-screen";
import { buildWeekStory } from "@/lib/week-story";
import { elapsedText, isCurrentAction, SimulationControlBody } from "@/lib/simulation-model";
import type { SimulationStatus } from "@/lib/simulation-model";
import { DecisionsView } from "./simulation/DecisionsView";
import { WeekStory } from "./simulation/WeekStory";
import { SimulationBar } from "./SimulationBar";
import { ModeChoice, ScenarioPicker } from "./wizard/SimulationChoice";

const plain = (text: string) => text.replace(/[  ]/g, " ");

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
  return { ...model, feed: { timeZone: "Europe/Moscow", check: null, days, names: { directions: {}, channels: {}, ads: {}, strategies: {} } }, ads, truthOf, story, storyOf };
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

  it("renders the comparison, the checklist and the feed in plain words, without the old ribbons and budget chart", async () => {
    render(<DecisionsView model={await run(false, new HeuristicPolicy())} />);
    expect(screen.getByText("Отключил рекламу, которая не приносит клиентов")).toBeTruthy();
    expect(screen.getAllByTestId("insight-truth").some((n) => n.textContent?.includes("не приводит обращений"))).toBe(true);
    expect(screen.getByTestId("sim-comparison").textContent).toContain("Если бы сервис ничего не делал");
    expect(screen.getByTestId("sim-result").textContent).toContain("Если бы сервис ничего не делал");
    expect(screen.queryByTestId("sim-lane")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Лента месяца|Расходы против бюджета/);
    expect(document.body.textContent).not.toMatch(/CTR|конверси|ставк|CPC|CPA/i);
  }, 60_000);
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
    expect(collecting?.decisions).toEqual([]);
    expect(collecting?.noDecisionReason).toBe("Объявления ещё собирали данные: решения сервис принимает, когда данных достаточно.");
    // The first week's own decision comes on the morning after its seven days and belongs to it.
    const first = await model.storyOf(1);
    expect(first?.days.map((d) => d.date)).toEqual(["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06", "2026-12-07"]);
    expect(await model.storyOf(9)).toBeNull();
  }, 60_000);

  it("plays the scenes and shows them all at once on «Показать сразу»", async () => {
    const model = await run(false, new HeuristicPolicy());
    const story = model.story;
    if (!story) throw new Error("no story");
    render(<WeekStory story={story} names={model.feed.names} />);
    // At first only the days are there, before they light up.
    expect(screen.queryByTestId("week-scene-decision")).toBeNull();
    expect(plain(screen.getByTestId("week-spend").textContent ?? "")).toBe("0 ₽");
    fireEvent.click(screen.getByRole("button", { name: /Показать сразу/ }));
    expect(screen.getByTestId("week-scene-review")).toBeTruthy();
    expect(screen.getByTestId("week-scene-decision")).toBeTruthy();
    expect(plain(screen.getByTestId("week-spend").textContent ?? "")).toBe(plain(formatRub(story.totals.spend)));
    expect(screen.getByTestId("week-compare").textContent).toContain("без него было бы");
  }, 60_000);

  it("shows every scene at once when the system asks for less motion", async () => {
    const model = await run(false, new HeuristicPolicy());
    const story = model.story;
    if (!story) throw new Error("no story");
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string): MediaQueryList => ({ ...original(query), matches: query.includes("reduce") });
    try {
      render(<WeekStory story={story} names={model.feed.names} />);
      expect(screen.getByTestId("week-scene-decision")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Показать сразу/ })).toBeNull();
    } finally {
      window.matchMedia = original;
    }
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
    expect(onEdit).toHaveBeenCalledWith(5);
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

describe("simulation pult", () => {
  const status: SimulationStatus = {
    day: 9,
    totalDays: 30,
    at: "2026-11-11T11:00:00Z",
    timeZone: "Europe/Moscow",
    status: "paused",
    step: null,
    weeks: 1,
    daysLeft: 22,
    ended: false,
    changes: 12,
    agentTurn: null,
    replay: { available: true, repeating: false, diverged: false },
  };

  it("shows the virtual day, «Прожить неделю» and the rare actions in the menu", () => {
    render(<SimulationBar initial={status} />);
    expect(screen.getByTestId("simulation-day").textContent).toBe("День 9 из 30 · 14:00");
    expect(screen.getByText(/Симуляция — реклама не показывается/)).toBeTruthy();
    expect(screen.getByTestId("simulation-step-week").textContent).toContain("Прожить неделю");
    expect(screen.getByRole("button", { name: "Начать заново" })).toBeTruthy();
    // No speed and no «До следующего решения»: the time moves only by steps.
    expect(screen.queryByText(/1 день = /)).toBeNull();
    expect(screen.queryByRole("button", { name: /До следующего решения/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ещё/ }));
    for (const text of ["+1 день", "Запустить по-настоящему"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it("says which day goes while a week is lived, and that the service is reviewing a day", () => {
    const { unmount } = render(<SimulationBar initial={{ ...status, status: "stepping", step: { kind: "week", week: 2 }, day: 10 }} />);
    expect(screen.getByTestId("simulation-progress").textContent).toBe("Неделя 2: идёт 10-й день");
    unmount();
    const { unmount: unmountDay } = render(<SimulationBar initial={{ ...status, status: "stepping", step: { kind: "week", week: 2 }, agentTurn: { day: 10, weekly: false } }} />);
    expect(screen.getByTestId("simulation-progress").textContent).toBe("Сервис разбирает 10-й день… · 0:00");
    unmountDay();
    // A week's review on a model takes minutes: the pult says so and counts the time, so it does not look stuck.
    render(<SimulationBar initial={{ ...status, status: "stepping", step: { kind: "week", week: 2 }, agentTurn: { day: 9, weekly: true } }} />);
    expect(screen.getByTestId("simulation-progress").textContent).toBe("Сервис разбирает неделю — обычно до 2–3 минут · 0:00");
    expect(elapsedText(125)).toBe("2:05");
  });

  it("names the days left at the end of the scenario", () => {
    render(<SimulationBar initial={{ ...status, day: 29, daysLeft: 2 }} />);
    expect(screen.getByTestId("simulation-step-week").textContent).toContain("Прожить оставшиеся 2 дня");
  });

  it("offers to repeat the run or to run it again, and warns that the agent may decide otherwise", async () => {
    render(<SimulationBar initial={status} />);
    fireEvent.click(screen.getByRole("button", { name: "Начать заново" }));
    expect(await screen.findByText(/рынок будет тем же, но агент может решить иначе/)).toBeTruthy();
    expect(screen.getByTestId("restart-repeat")).not.toBeDisabled();
    expect(screen.getByTestId("restart-fresh")).toBeTruthy();
  });

  it("offers only to run again when the run had no decisions on a model", async () => {
    render(<SimulationBar initial={{ ...status, replay: { available: false, repeating: false, diverged: false } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Начать заново" }));
    expect(await screen.findByTestId("restart-repeat")).toBeDisabled();
  });

  it("says once that the owner changed the course of a repeated run", () => {
    render(<SimulationBar initial={{ ...status, replay: { available: true, repeating: true, diverged: true } }} />);
    expect(screen.getByTestId("simulation-diverged").textContent).toContain("Вы изменили ход прогона — дальше сервис решает заново");
  });

  it("offers to continue for 30 more days at the end", () => {
    render(<SimulationBar initial={{ ...status, day: 30, daysLeft: 0, ended: true }} />);
    expect(screen.getByRole("button", { name: "Продолжить ещё 30 дней" })).toBeTruthy();
    expect(screen.queryByTestId("simulation-step-week")).toBeNull();
  });
});
