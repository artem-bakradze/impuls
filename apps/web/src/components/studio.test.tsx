import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HistoryItem } from "@/lib/history-view";
import type { AdsWork } from "@/lib/server/simulation-screen";
import type { JournalEntry, ShownAd } from "@/lib/service-work";
import type { SimulationStatus } from "@/lib/simulation-model";
import type { SummaryModel } from "@/lib/summary-model";
import { AppHeader } from "./AppHeader";
import { SimulationStudio } from "./simulation/SimulationStudio";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/summary", useSearchParams: () => new URLSearchParams() }));

const item: HistoryItem = {
  id: "c1",
  at: "2026-11-11T06:00:00Z",
  author: "service",
  object: "Объявление «Маникюр у метро»",
  diff: [{ label: "Цена перехода", before: "300 ₽", after: "330 ₽" }],
  explanation: "Компьютеры дают обращения по 414 ₽ — дешевле цели.",
  outcome: null,
  turnId: "t1",
  insight: null,
  status: "applied",
  reverted: false,
  rollback: { kind: "available", consequences: [] },
  budgetAdjustment: false,
};

const ad = (overrides: Partial<ShownAd> = {}): ShownAd => ({
  id: "a1",
  directionId: "d1",
  title: "Автоматизация ресторанов доставки",
  text: "Подключение платформы",
  channel: "search",
  verdict: "effective",
  fresh: false,
  pending: false,
  checking: false,
  clicks: 30,
  leads: 5,
  impressions: 1_240,
  spend: 173_000,
  costPerLead: 34_600,
  change: null,
  ...overrides,
});

const review: JournalEntry = {
  id: "2026-11-11:day",
  date: "2026-11-11",
  from: null,
  day: 9,
  kind: "agent",
  weekly: false,
  headline: null,
  paragraphs: ["Компьютеры дают обращения по 414 ₽ — дешевле цели."],
  changes: [{ text: "Поднял цену перехода с компьютеров на 10%", reverted: false, historyId: "c1", item, facts: [{ label: "Цена обращения с компьютеров", value: "414 ₽" }, { label: "Цель", value: "1 000 ₽" }], turnId: "t1" }],
  checking: [],
  found: [],
  expects: [],
  truths: [],
  objectIds: ["a1"],
};

const status = (overrides: Partial<SimulationStatus> = {}): SimulationStatus => ({
  day: 10,
  totalDays: 30,
  at: "2026-11-11T10:00:00Z",
  timeZone: "Europe/Moscow",
  status: "paused",
  step: null,
  weeks: 1,
  daysLeft: 21,
  ended: false,
  changes: 12,
  agentTurn: null,
  replay: { available: true, repeating: false, diverged: false },
  ...overrides,
});

const model = (overrides: Partial<SummaryModel> = {}): SummaryModel => ({
  timeZone: "Europe/Moscow",
  dataPeriod: { from: "2026-11-01", to: "2026-11-11", asOf: "2026-11-11T10:00:00Z", month: "2026-11", previousPartial: false },
  daily: [{ date: "2026-11-10", leads: 2, spend: 100_000, decision: false }],
  period: "month",
  state: "running",
  simulation: { weeks: 1 },
  launchedDays: 10,
  compare: false,
  launchMonth: null,
  monthlyBudget: 1_500_000,
  moderation: { pending: 0, accepted: 2, rejected: 0 },
  monthBudget: 3_000_000,
  spentMonth: 690_000,
  budgetPlan: 1_100_000,
  spend: { value: 690_000, previous: 500_000 },
  leads: { value: 14, previous: 12 },
  clients: { value: null, previous: null },
  clientCost: { kind: "unknown", costPerLead: 49_286, hint: "", week: "2026-11-02" },
  goal: { mode: "auto", cso: 100_000, learned: false, current: 49_286, status: "within" },
  feed: { timeZone: "Europe/Moscow", check: null, days: [], names: { directions: {}, channels: {}, ads: {}, strategies: {} } },
  decided: true,
  budgetForecast: null,
  attention: { notifications: [], clientsQuestion: null },
  directions: [],
  ...overrides,
});

const work = (overrides: Partial<AdsWork> = {}): AdsWork => ({
  shown: [ad(), ad({ id: "a2", title: "Интеграция с агрегаторами", leads: 4, spend: 160_400, costPerLead: 40_100 })],
  hidden: [],
  directionChanges: [],
  journal: [{ week: 2, from: "2026-11-09", to: "2026-11-15", entries: [review] }],
  brief: null,
  lastChange: null,
  recentChanges: [],
  changesLast7: 1,
  nextCheck: null,
  cso: 100_000,
  site: "goulash.tech",
  history: [item],
  names: { directions: {}, channels: {}, ads: {}, strategies: {} },
  sim: null,
  ...overrides,
});

describe("simulation studio (simulation-mode spec «Симуляция как отдельный режим»)", () => {
  it("shows the last lived day, the ads and the review as a note: what the service sees and what it did", () => {
    render(<SimulationStudio model={model()} work={work()} initial={status()} />);
    expect(screen.getByText("День 10")).toBeTruthy();
    expect(screen.getByText("прожит")).toBeTruthy();
    expect(screen.getAllByTestId("studio-ad")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Разбор дня · 11 ноября" })).toBeTruthy();
    const note = screen.getByTestId("studio-review");
    expect([...note.querySelectorAll(".studio-note-part")].map((part) => part.textContent)).toEqual([
      "Что вижуКомпьютеры дают обращения по 414 ₽ — дешевле цели.",
      "Что сделалПоднял цену перехода с компьютеров на 10%. Вернуть как было",
    ]);
    expect(note.textContent).not.toMatch(/Уже в работе|Оставить как есть|Почему так|Чего жду/);
    expect(screen.getByRole("link", { name: "Подробнее — в истории ›" })).toHaveAttribute("href", "/summary#log-2026-11-11:day");
  });

  it("keeps no form in the review: one link to undo, and the day's button under the ads is the one main button", () => {
    const { container } = render(<SimulationStudio model={model()} work={work()} initial={status()} />);
    const note = screen.getByTestId("studio-review");
    expect([...note.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Вернуть как было"]);
    expect(note.querySelector("details")).toBeNull();
    expect([...container.querySelectorAll(".studio-primary")].map((b) => b.textContent)).toEqual(["Прожить следующий день"]);
    expect(container.querySelector(".studio-stage .studio-actions")).toHaveTextContent("Прожить следующий деньПрожить неделю");
  });

  it("says what the service expects and when it checks, and that an undone change was undone", () => {
    const expecting: JournalEntry = {
      ...review,
      weekly: true,
      changes: [{ ...review.changes[0]!, reverted: true }],
      expects: ["К 16 ноября проверю стоимость и число обращений с компьютеров.", "Жду больше обращений с компьютеров по цене не выше цели."],
      checking: [{ statement: "Проверяю, останется ли стоимость обращений с компьютеров ниже цели.", checkOn: "2026-11-16" }],
    };
    render(<SimulationStudio model={model()} work={work({ journal: [{ week: 2, from: "2026-11-09", to: "2026-11-15", entries: [expecting] }] })} initial={status()} />);
    const note = screen.getByTestId("studio-review");
    expect(note).toHaveTextContent("Поднял цену перехода с компьютеров на 10% — вы вернули как было.");
    expect(screen.queryByRole("button", { name: "Вернуть как было" })).toBeNull();
    expect(note.querySelectorAll(".studio-note-part")[2]?.textContent).toBe("Чего ждуЖду больше обращений с компьютеров по цене не выше цели. 16 ноября проверю, останется ли стоимость обращений с компьютеров ниже цели.");
    expect(note.textContent).not.toContain("К 16 ноября проверю стоимость");
  });

  it("tells a quiet day in one paragraph, without empty ones", () => {
    const quiet: JournalEntry = { ...review, kind: "quiet", headline: null, paragraphs: ["Посмотрели рекламу — менять ничего не нужно."], changes: [] };
    render(<SimulationStudio model={model()} work={work({ journal: [{ week: 2, from: "2026-11-09", to: "2026-11-15", entries: [quiet] }] })} initial={status()} />);
    expect(within(screen.getByTestId("studio-review")).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Что вижу"]);
  });

  it("says the market is a training one without sounding like a failure", () => {
    render(<SimulationStudio model={model()} work={work()} initial={status()} />);
    expect(screen.getByTestId("studio-disclaimer")).toHaveTextContent("Учебный рынок · деньги не списываются");
    expect(screen.queryByText("Реклама не показывается")).toBeNull();
  });

  it("shows «Запустить по-настоящему» without opening a menu, behind the same confirmation", async () => {
    render(<SimulationStudio model={model()} work={work()} initial={status()} />);
    fireEvent.click(screen.getByRole("button", { name: "Запустить по-настоящему" }));
    expect((await screen.findAllByText("Запустить настоящую рекламу?")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Данные симуляции удалятся без возможности вернуть/)).toBeTruthy();
  });

  it("shows each ad as in Yandex with one result: its cost per lead against the goal in words and its leads", () => {
    render(<SimulationStudio model={model()} work={work()} initial={status()} />);
    const [first, second] = screen.getAllByTestId("studio-ad");
    expect(first?.querySelector(".studio-ad-site")).toHaveTextContent("goulash.tech · поиск");
    expect(first?.querySelector("h3")).toHaveTextContent("Автоматизация ресторанов доставки");
    expect(first?.querySelector(".studio-ad-text")).toHaveTextContent("Подключение платформы");
    expect(screen.getAllByTestId("studio-ad-result").map((r) => r.textContent)).toEqual(["на 65% дешевле ориентира", "на 59% дешевле ориентира"]);
    expect(screen.getAllByTestId("studio-ad-result")[0]).toHaveAttribute("data-tone", "good");
    expect(first?.querySelector(".studio-ad-state")?.textContent).toBe("работает хорошо5 обращений");
    expect(second?.textContent).not.toMatch(/потрачено|по \d/);
    expect(document.querySelector(".studio-ad-bar")).toBeNull();
  });

  it("opens an ad's numbers of the 7 days and the rule of its estimate on its result", async () => {
    render(<SimulationStudio model={model()} work={work()} initial={status()} />);
    fireEvent.click(screen.getAllByTestId("studio-ad-result")[0]!);
    const numbers = await screen.findByTestId("studio-ad-numbers");
    const rows = [...numbers.querySelectorAll("dl div")].map((row) => row.textContent?.replace(/ /g, " "));
    expect(rows).toEqual(["Потрачено1 730 ₽", "Обращения5", "Цена обращения346 ₽", "Ориентир1 000 ₽", "Переходы на сайт30", "Показы1 240"]);
    expect(numbers.querySelector(".studio-ad-numbers-rule")?.textContent?.replace(/ /g, " ")).toBe("Работает хорошо — 3 обращения и больше, в среднем не дороже 700 ₽.");
  });

  it("sums up leads, the cost per lead against the goal and the month's money with the plan mark", () => {
    render(<SimulationStudio model={model()} work={work()} initial={status()} />);
    const summary = screen.getByTestId("studio-summary");
    const metrics = [...summary.querySelectorAll(".studio-metric")].map((m) => m.textContent?.replace(/ /g, " "));
    expect(metrics).toEqual(["14обращений", "492 ₽за обращение · ориентир 1 000 ₽", "6 900 ₽потрачено из 30 000 ₽"]);
    expect(summary.querySelector(".studio-summary-period")).toHaveTextContent("1–11 ноября");
    expect(screen.getByTestId("studio-budget").textContent?.replace(/ /g, " ")).toBe("к 11 ноября план 11 000 ₽");
    expect(screen.getByTestId("studio-budget").querySelector("i")).toHaveStyle({ width: "23%" });
  });

  it("marks a cost per lead over the goal, an ad dearer than it and an ad without leads", () => {
    const dear = ad({ id: "a2", verdict: "borderline", leads: 2, spend: 240_000, costPerLead: 120_000 });
    const quiet = ad({ id: "a3", title: "Настройка онлайн", verdict: "learning", leads: 0, spend: 39_500, costPerLead: null });
    const { container } = render(
      <SimulationStudio model={model({ goal: { mode: "user", cso: 100_000, learned: false, current: 140_000, status: "above" } })} work={work({ shown: [ad(), dear, quiet] })} initial={status()} />,
    );
    expect(container.querySelector(".studio-metric-value[data-tone=danger]")?.textContent?.replace(/ /g, " ")).toBe("1 400 ₽");
    expect(screen.getByTestId("studio-summary")).toHaveTextContent("за обращение · цель 1 000 ₽");
    expect(container.querySelector(".studio-ads-head")?.textContent).toBe("Объявления · за 7 дней");
    const results = screen.getAllByTestId("studio-ad-result");
    expect(results.map((r) => r.textContent)).toEqual(["на 65% дешевле цели", "на 20% дороже цели", "пока без обращений"]);
    expect(results.map((r) => r.getAttribute("data-tone"))).toEqual(["good", "bad", "neutral"]);
    const [, , last] = screen.getAllByTestId("studio-ad");
    expect(last?.querySelector(".studio-ad-state")?.textContent).toBe("собирает данные");
    expect(last?.querySelector(".studio-ad-verdict")).toHaveAttribute("data-verdict", "learning");
  });

  it("names the calendar day, the scenario and each ad's estimate in words", () => {
    const sim = { comparison: null, result: null, decisionDays: [], day: 11, totalDays: 30, scenarioTitle: "Обычный месяц", ended: false };
    render(<SimulationStudio model={model()} work={work({ sim })} initial={status()} />);
    expect(document.querySelector(".studio-day-of")?.textContent).toBe("из 30 · 11 ноября");
    expect(screen.getByTestId("studio-scenario")).toHaveTextContent("сценарий «Обычный месяц»");
    expect(screen.getAllByTestId("studio-ad-verdict").map((v) => v.textContent)).toEqual(["работает хорошо", "работает хорошо"]);
  });

  it("explains starting over without the words «модель» and «агент»", async () => {
    render(<SimulationStudio model={model()} work={work()} initial={status()} />);
    fireEvent.click(screen.getByRole("button", { name: "Ещё: начать заново" }));
    fireEvent.click(await screen.findByText("Начать заново"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("сервис будет решать заново");
    expect(dialog.textContent).not.toMatch(/модел|агент/i);
  });

  it("starts from an empty review and one day button", () => {
    render(<SimulationStudio model={model({ leads: { value: 0, previous: 0 }, spentMonth: 0 })} work={work({ journal: [], shown: [] })} initial={status({ day: 1, weeks: 0, changes: 1, daysLeft: 30 })} />);
    expect(screen.getByText("День 1")).toBeTruthy();
    expect(screen.getByText("впереди")).toBeTruthy();
    expect(screen.getByText(/После дня здесь появится разбор/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Прожить день" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Прожить неделю" })).toBeTruthy();
  });

  it("shows the day running, with no way to press it twice", () => {
    render(<SimulationStudio model={model()} work={work()} initial={status({ status: "stepping", step: { kind: "day", week: null } })} />);
    expect(screen.getByText("идёт")).toBeTruthy();
    expect(screen.getByRole("button", { name: "День идёт…" })).toBeDisabled();
    expect(screen.getByTestId("studio-thinking")).toBeTruthy();
  });

  it("offers to continue for 30 more days when the scenario ends", () => {
    render(<SimulationStudio model={model()} work={work()} initial={status({ day: 30, daysLeft: 0, ended: true })} />);
    expect(screen.getByRole("button", { name: "Продолжить ещё 30 дней" })).toBeTruthy();
  });
});

describe("navigation in a simulation", () => {
  it("adds the simulation tab only when the business is simulated", () => {
    const { unmount } = render(<AppHeader launched simulated signOutAction={() => Promise.resolve()} />);
    expect(screen.getByRole("link", { name: "Симуляция" })).toHaveAttribute("href", "/simulation");
    unmount();
    render(<AppHeader launched signOutAction={() => Promise.resolve()} />);
    expect(screen.queryByRole("link", { name: "Симуляция" })).toBeNull();
  });
});
