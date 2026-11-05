import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistoryItem } from "@/lib/history-view";
import type { AdsWork } from "@/lib/server/simulation-screen";
import type { JournalEntry, ShownAd } from "@/lib/service-work";
import type { SimulationStatus } from "@/lib/simulation-model";
import type { SummaryModel } from "@/lib/summary-model";
import { AppHeader } from "./AppHeader";
import { SummaryView } from "./summary/SummaryView";

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

const sim = { comparison: null, result: null, decisionDays: [], day: 11, totalDays: 30, scenarioTitle: "Обычный месяц", ended: false, startedOn: "2026-11-01" };
const plain = (node: Element | null): string => node?.textContent?.replace(/[  ]/g, " ") ?? "";

describe("one «Реклама» in a simulation (simulation-mode spec «Симуляция как отдельный режим»)", () => {
  it("puts the assistant's review beside the answer and the player under the review", () => {
    const { container } = render(<SummaryView model={model()} work={work({ sim, lastChange: { text: "Цена перехода +10%", date: "2026-11-11", reason: null, entryId: review.id, historyId: "c1", item } })} simulation={status()} />);
    const player = screen.getByTestId("sim-player");
    expect(plain(player.querySelector("[data-testid=studio-day]"))).toBe("День 10");
    expect(screen.getByTestId("studio-status")).toHaveTextContent("прожит");
    // The run has no visible length: no «из 30», no scenario's name, no days strip.
    expect(plain(player)).not.toMatch(/из 30|сценари/);
    expect(player.querySelector(".studio-strip")).toBeNull();
    expect(screen.getByTestId("studio-disclaimer")).toHaveTextContent("Учебный рынок · деньги не списываются");
    expect([...container.querySelectorAll(".studio-primary")].map((b) => b.textContent)).toEqual(["Прожить следующий день"]);
    expect(screen.getByRole("button", { name: "Прожить неделю" })).toBeTruthy();
    // The player is pressed where its result is read: in the review's column, right under the review.
    expect(player.parentElement?.className).toBe("brief-aside");
    expect(player.previousElementSibling).toBe(screen.getByTestId("review-rail"));
    expect(player.querySelector(".sim-player-foot")?.textContent).toContain("Запустить по-настоящему");
    // The numbers are the brief's own: no second total, no ad cards of a studio.
    expect(screen.getByTestId("brief")).toBeTruthy();
    expect(screen.queryByTestId("studio-ad")).toBeNull();
    expect(screen.queryByTestId("studio-summary")).toBeNull();
    // The review beside the answer: the assistant's avatar, its name, the day as a number, the message.
    const rail = screen.getByTestId("review-rail");
    expect(rail.querySelector("svg.agent-avatar")).not.toBeNull();
    expect(rail.querySelector(".studio-msg-name")).toHaveTextContent("Импульс");
    expect(screen.getByRole("heading", { level: 2, name: "Разбор дня · день 11" })).toBeTruthy();
    const note = screen.getByTestId("studio-review");
    expect([...note.querySelectorAll(".studio-msg-text")].map((p) => p.textContent)).toEqual(["Компьютеры дают обращения по 414 ₽ — дешевле цели."]);
    expect([...note.querySelectorAll(".studio-msg-action")].map((a) => a.textContent)).toEqual(["Поднял цену перехода с компьютеров на 10%.Вернуть как было"]);
    // The last change is in the review: it is not said twice.
    expect(screen.queryByTestId("last-change")).toBeNull();
    expect(screen.queryByTestId("service-changes")).toBeNull();
  });

  it("names days by their numbers, in its own lines and in the agent's words", () => {
    const expecting: JournalEntry = {
      ...review,
      paragraphs: ["Сохранил наблюдение и проверю результаты к 15 ноября."],
      checking: [{ statement: "Проверяю, останется ли стоимость обращений с компьютеров ниже цели.", checkOn: "2026-11-16" }],
    };
    const nextCheck = { statement: "Проверяю, останется ли стоимость обращений с компьютеров ниже цели.", checkOn: "2026-11-16", more: 0 };
    render(<SummaryView model={model()} work={work({ sim, nextCheck, journal: [{ week: 2, from: "2026-11-09", to: "2026-11-15", entries: [expecting] }] })} simulation={status()} />);
    expect(plain(screen.getByTestId("data-period"))).toBe("дни 1–11");
    expect(plain(screen.getByTestId("next-step"))).toBe("Дальшев день 16 сервис проверит, останется ли стоимость обращений с компьютеров ниже цели");
    const texts = [...screen.getByTestId("studio-review").querySelectorAll(".studio-msg-text")].map((p) => plain(p));
    expect(texts).toEqual(["Сохранил наблюдение и проверю результаты ко дню 15.", "В день 16 проверю, останется ли стоимость обращений с компьютеров ниже цели."]);
    expect(plain(document.body)).not.toMatch(/ноябр/);
  });

  it("types while the day goes, with no way to press it twice", () => {
    render(<SummaryView model={model()} work={work({ sim })} simulation={status({ status: "stepping", step: { kind: "day", week: null } })} />);
    expect(screen.getByTestId("studio-status")).toHaveTextContent("идёт");
    expect(screen.getByRole("button", { name: "День идёт…" })).toBeDisabled();
    expect(screen.getByTestId("studio-thinking")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Сервис пишет разбор" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Разбирает день" })).toBeTruthy();
  });

  it("writes a review that arrives after a step part by part, and shows the one the page opened with at once", () => {
    const { rerender } = render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    expect(screen.getByTestId("studio-review")).not.toHaveClass("studio-msg-reveal");
    const next: JournalEntry = { ...review, id: "2026-11-12:day", date: "2026-11-12" };
    rerender(<SummaryView model={model()} work={work({ sim, journal: [{ week: 2, from: "2026-11-09", to: "2026-11-15", entries: [review, next] }] })} simulation={status()} />);
    const note = screen.getByTestId("studio-review");
    expect(note).toHaveClass("studio-msg-reveal");
    expect([...note.querySelectorAll<HTMLElement>(".studio-msg-text, .studio-msg-action, .studio-msg-more")].map((part) => part.style.getPropertyValue("--i"))).toEqual(["0", "1", "2"]);
    expect(screen.getByRole("heading", { level: 2, name: "Разбор дня · день 12" })).toBeTruthy();
  });

  it("opens the history on the review's record from «Подробнее — в истории»", () => {
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    fireEvent.click(screen.getByText("Подробнее — в истории ›"));
    expect(screen.getByTestId("agent-journal")).toBeTruthy();
    expect(window.location.hash).toBe("#log-2026-11-11:day");
    window.location.hash = "";
  });

  it("promises the first review before the first day", () => {
    render(<SummaryView model={model({ state: "first_day", leads: { value: 0, previous: 0 }, spentMonth: 0 })} work={work({ sim, journal: [], shown: [] })} simulation={status({ day: 1, weeks: 0, changes: 1, daysLeft: 30 })} />);
    expect(screen.getByTestId("studio-status")).toHaveTextContent("впереди");
    expect(screen.getByRole("button", { name: "Прожить день" })).toBeTruthy();
    expect(screen.getByText("После первого дня я напишу здесь, что заметил в рекламе и что изменил.")).toBeTruthy();
  });

  it("shows «Запустить по-настоящему» without opening a menu, behind the same confirmation", async () => {
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    fireEvent.click(screen.getByRole("button", { name: "Запустить по-настоящему" }));
    expect((await screen.findAllByText("Запустить настоящую рекламу?")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Данные симуляции удалятся без возможности вернуть/)).toBeTruthy();
  });

  it("explains starting over without the words «модель» and «агент»", async () => {
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    fireEvent.click(screen.getByRole("button", { name: "Ещё: начать заново" }));
    fireEvent.click(await screen.findByText("Начать заново"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("сервис будет решать заново");
    expect(dialog.textContent).not.toMatch(/модел|агент/i);
  });

  it("goes on after the scenario's last day with the same next step, without an end", () => {
    render(<SummaryView model={model()} work={work({ sim })} simulation={status({ day: 30, daysLeft: 0, ended: true })} />);
    expect(screen.getByTestId("studio-day")).toHaveTextContent("День 30");
    expect(screen.getByTestId("studio-status")).toHaveTextContent("прожит");
    expect(screen.getByRole("button", { name: "Прожить следующий день" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Прожить неделю" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Продолжить ещё|оставш/ })).toBeNull();
    expect(screen.getByTestId("sim-player")).not.toHaveTextContent("завершён");
  });
});

describe("«Реклама» in Direct keeps the calendar and has no player (simulation-mode spec «Дни симуляции вместо дат»)", () => {
  it("shows dates and the review beside the answer, without the player", () => {
    render(<SummaryView model={model({ simulation: null })} work={work()} />);
    expect(screen.queryByTestId("sim-player")).toBeNull();
    expect(plain(screen.getByTestId("data-period"))).toBe("1–11 ноября");
    expect(screen.getByRole("heading", { level: 2, name: "Разбор дня · 11 ноября" })).toBeTruthy();
  });

  it("keeps the last change in the answer when the review does not say it", () => {
    const quiet: JournalEntry = { ...review, kind: "quiet", headline: null, paragraphs: ["Посмотрели рекламу — менять ничего не нужно."], changes: [] };
    const lastChange = { text: "Лимит 1 077 ₽", date: "2026-11-10", reason: "Реклама приводит клиентов дешевле цели.", entryId: "2026-11-10:day", historyId: "c9", item: { ...item, id: "c9" } };
    render(<SummaryView model={model({ simulation: null })} work={work({ lastChange, journal: [{ week: 2, from: "2026-11-09", to: "2026-11-15", entries: [quiet] }] })} />);
    expect(plain(screen.getByTestId("last-change"))).toContain("вчераЛимит 1 077 ₽");
    expect(screen.getByTestId("studio-review").querySelector(".studio-msg-action")).toBeNull();
  });
});

describe("a pressed step (simulation-mode spec: a step that is not over is not shown as lived)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the step going until the worker takes it, instead of «прожит» about the day before", async () => {
    vi.useFakeTimers();
    let server: SimulationStatus = status();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const body = url === "/api/simulation" && init?.method === "POST" ? { jobId: "j1" } : url.startsWith("/api/jobs/") ? { state: "running" } : server;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      }),
    );
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    fireEvent.click(screen.getByRole("button", { name: "Прожить следующий день" }));
    // The worker has not taken the step yet: the server still says «paused» about day 10.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(screen.getByTestId("studio-status")).toHaveTextContent("идёт");
    expect(screen.queryByTestId("studio-review")).toBeNull();
    server = status({ status: "stepping", step: { kind: "day", week: null } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(screen.getByTestId("studio-status")).toHaveTextContent("идёт");
    server = status({ day: 11, daysLeft: 20 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(screen.getByTestId("studio-status")).toHaveTextContent("прожит");
    expect(screen.getByTestId("studio-day")).toHaveTextContent("День 11");
  });
});

describe("two sections in both modes (simulation-mode spec «Симуляция как отдельный режим»)", () => {
  it("has no «Симуляция» in the navigation", () => {
    render(<AppHeader launched signOutAction={() => Promise.resolve()} />);
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Импульс", "Реклама", "Настройки"]);
  });
});
