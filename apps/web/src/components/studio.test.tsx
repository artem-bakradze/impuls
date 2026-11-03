import { fireEvent, render, screen } from "@testing-library/react";
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
  site: "goulash.tech",
  history: [item],
  names: { directions: {}, channels: {}, ads: {}, strategies: {} },
  sim: null,
  ...overrides,
});

describe("simulation studio (simulation-mode spec «Симуляция как отдельный режим»)", () => {
  it("shows the last lived day, the ads and the decision that is already in work", () => {
    render(<SimulationStudio model={model()} work={work()} initial={status()} />);
    expect(screen.getByText("День 10")).toBeTruthy();
    expect(screen.getByText("прожит")).toBeTruthy();
    expect(screen.getAllByTestId("studio-ad")).toHaveLength(2);
    expect(screen.getByTestId("studio-review")).toHaveTextContent("Поднял цену перехода с компьютеров на 10%");
    expect(screen.getByText(/Уже в работе/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Оставить как есть" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Вернуть как было" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Прожить следующий день" })).toBeTruthy();
  });

  it("acknowledges a decision without pretending it needed permission", () => {
    render(<SimulationStudio model={model()} work={work()} initial={status()} />);
    fireEvent.click(screen.getByRole("button", { name: "Оставить как есть" }));
    expect(screen.getByText("Оставлено")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Оставить как есть" })).toBeNull();
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
