import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HistoryItem } from "@/lib/history-view";
import type { InsightCardModel, InsightFeedModel } from "@/lib/insights-model";
import type { AdsWork } from "@/lib/server/simulation-screen";
import type { SummaryModel } from "@/lib/summary-model";
import { SummaryView } from "./summary/SummaryView";
import { AdvertiserDataNotice } from "./wizard/LaunchStep";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/summary", useSearchParams: () => new URLSearchParams() }));

const rollbackItem: HistoryItem = {
  id: "c1",
  at: "2026-10-27T06:00:00Z",
  author: "service",
  object: "Объявление «Маникюр без записи»",
  diff: [{ label: "Показы", before: "работает", after: "на паузе" }],
  explanation: "Отключили объявление «Маникюр без записи».",
  outcome: null,
  turnId: "t1",
  insight: null,
  status: "applied",
  reverted: false,
  rollback: { kind: "available", consequences: [] },
  budgetAdjustment: false,
};

const pauseCard: InsightCardModel = {
  id: "i1",
  author: "agent",
  at: "2026-10-27T06:00:00Z",
  observation: "Объявление «Маникюр без записи» тратит деньги и не приводит клиентов.",
  facts: [
    { label: "Объявление «Маникюр без записи»: расход за 14 дней", value: "1 530 ₽" },
    { label: "Объявление «Маникюр без записи»: обращения за 14 дней", value: "0" },
    { label: "Цель", value: "300 ₽ за обращение" },
  ],
  decision: { text: "Отключили объявление «Маникюр без записи»", status: "applied" },
  next: "Через 7 дней сравним цену обращения рекламы в поиске с прежней.",
  rollback: rollbackItem,
  truth: null,
  objectIds: ["a2"],
};

const feed = (overrides: Partial<InsightFeedModel> = {}): InsightFeedModel => ({
  timeZone: "Europe/Moscow",
  check: null,
  days: [{ date: "2026-10-27", from: null, summary: "Отключили одно объявление: оно тратило деньги без обращений.", quiet: false, rulesReason: null, insights: [pauseCard], weekly: null }],
  names: { directions: {}, channels: {}, ads: {}, strategies: {} },
  ...overrides,
});

const summary = (overrides: Partial<SummaryModel> = {}): SummaryModel => ({
  timeZone: "Europe/Moscow",
  period: "week",
  state: "running",
  simulation: null,
  launchedDays: 28,
  compare: true,
  launchMonth: null,
  monthlyBudget: 1_500_000,
  moderation: { pending: 0, accepted: 3, rejected: 0 },
  monthBudget: 1_500_000,
  spentMonth: 630_000,
  spend: { value: 630_000, previous: 500_000 },
  leads: { value: 11, previous: 8 },
  clients: { value: 7, previous: 5 },
  clientCost: { kind: "known", costPerClient: 90_000, clients: 7, week: "2026-10-19" },
  goal: { mode: "user", cso: 30_000, learned: false, current: 34_000, status: "above" },
  feed: feed(),
  decided: true,
  budgetForecast: null,
  attention: { notifications: [], clientsQuestion: { week: "2026-10-19", weekEnd: "2026-10-25", leads: 11 } },
  directions: [{ id: "d1", name: "Маникюр — Поиск", channel: "search", status: "active", ads: 3, weeklyLimit: 210_000, spend: 630_000, leads: 11, costPerLead: 57_273 }],
  ...overrides,
});

const plain = (node: { textContent: string | null } | null): string => node?.textContent?.replace(/[  ]/g, " ") ?? "";

/** «Реклама» without ads and journal records unless a test gives them. */
const work = (overrides: Partial<AdsWork> = {}): AdsWork => ({
  shown: [],
  hidden: [],
  directionChanges: [],
  journal: [],
  brief: null,
  site: "nogotok.example",
  history: [],
  names: { directions: {}, channels: {}, ads: {}, strategies: {} },
  sim: null,
  ...overrides,
});

const ownerEntry = {
  id: "h:c2", date: "2026-10-28", from: null, day: 10, kind: "owner" as const, weekly: false, headline: null, paragraphs: [],
  changes: [{ text: "Вы: время показа — было Пн–Вс 10:00–20:00 → стало Пн–Вс 10:00–21:00", reverted: false, historyId: "c2", item: { ...rollbackItem, id: "c2", author: "user" as const }, facts: [], turnId: null }],
  checking: [], found: [], truths: [], objectIds: [],
};
const decisionEntry = {
  id: "2026-10-27:day", date: "2026-10-27", from: null, day: 9, kind: "agent" as const, weekly: false, headline: null, paragraphs: ["Объявление тратило деньги без обращений."],
  changes: [{ text: "Отключил объявление «Маникюр без записи»", reverted: false, historyId: "c1", item: rollbackItem, facts: pauseCard.facts, turnId: "t1" }],
  checking: [], found: [], truths: [], objectIds: ["a2"],
};

describe("«Реклама» (analytics spec «Главный экран «Реклама»»)", () => {
  it("labels the confirmed client's week and does not mix its count with the selected period", () => {
    render(<SummaryView model={summary({ clients: { value: 20, previous: 10 } })} work={work()} />);
    expect(screen.getByText("Клиентов: 7 · 19 октября — 25 октября")).toBeInTheDocument();
  });

  it("shows the month's three numbers with the budget as the third, without a period switch, graph or platforms", () => {
    const { container } = render(<SummaryView model={summary({ daily: [{ date: "2026-10-27", leads: 11, decision: true }] })} work={work()} />);
    expect(container.querySelectorAll(".summary-kpis .kpi")).toHaveLength(3);
    expect(plain(container.querySelector(".summary-kpis"))).toContain("Цена обращения340 ₽");
    expect(plain(screen.getByTestId("budget-tile"))).toContain("6 300 ₽из 15 000 ₽ · сервис сам держит расход в бюджете месяца");
    expect(screen.queryByRole("region", { name: "Обращения по дням" })).toBeNull();
    expect(screen.queryByText("Неделя")).toBeNull();
    expect(screen.queryByRole("button", { name: /Цифры по площадкам/ })).toBeNull();
    expect(screen.queryByText(/О бюджете и сравнении/)).toBeNull();
    expect(screen.getByTestId("shown-ads")).toBeTruthy();
    expect(screen.getByTestId("agent-journal")).toBeTruthy();
  });

  it("shows the hint instead of an invented cost per client", () => {
    const { container } = render(
      <SummaryView model={summary({ clientCost: { kind: "unknown", costPerLead: 57_273, hint: "Ответьте, сколько обращений стали клиентами, чтобы видеть стоимость клиента", week: "2026-10-19" } })} work={work()} />,
    );
    expect(screen.getByTestId("clients-question")).toBeTruthy();
    expect(container.textContent).not.toContain("Стоимость клиента:");
  });

  it("shows the cost per lead with the goal and its status when there are no clients answers", () => {
    render(<SummaryView model={summary({ clientCost: { kind: "unknown", costPerLead: 34_000, hint: "", week: "2026-10-19" }, attention: { notifications: [], clientsQuestion: null } })} work={work()} />);
    expect(plain(screen.getByTestId("goal-line"))).toBe("Цель: до 300 ₽");
    expect(screen.getByText("Дороже цели")).toBeTruthy();
  });

  it("explains a short launch month and does not compare with the time before the launch", () => {
    const { container } = render(
      <SummaryView model={summary({ compare: false, launchedDays: 3, launchMonth: { budget: 96_700, monthName: "октября", nextMonthName: "ноября" }, monthBudget: 96_700 })} work={work()} />,
    );
    const text = plain(container);
    expect(text).toContain("До конца октября — 967 ₽, с 1 ноября — 15 000 ₽ в месяц");
    expect(text).toContain("С запуска · 3 дня");
    expect(text).not.toContain("в прошлом периоде");
  });

  it("speaks of the simulation, not of Yandex, and offers to live the first week", () => {
    const { container } = render(
      <SummaryView model={summary({ state: "first_day", simulation: { weeks: 0 }, spentMonth: 0, decided: false, feed: feed({ days: [] }), attention: { notifications: [], clientsQuestion: null } })} work={work()} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Симуляция запущена");
    expect(text).toContain("в первую неделю");
    expect(text).not.toMatch(/Яндекс проверяет|проверку Яндекса|в вашем Яндекс Директе|в течение суток|пересчитывает/);
    expect(screen.getByRole("button", { name: /Прожить первую неделю/ })).toBeTruthy();
  });

  it("shows the launch state and the month budget on the first day, without empty blocks", () => {
    const { container } = render(
      <SummaryView model={summary({ state: "first_day", spentMonth: 0, monthBudget: 145_100, feed: feed({ days: [] }), moderation: { pending: 3, accepted: 0, rejected: 0 }, attention: { notifications: [], clientsQuestion: null } })} work={work()} />,
    );
    const text = plain(container);
    expect(text).toContain("Первые результаты появятся в течение суток");
    expect(plain(screen.getByTestId("first-day-budget"))).toBe("Потрачено 0 ₽ из 1 451 ₽ в этом месяце — больше не потратим");
    expect(text).not.toContain("Нужно ваше участие");
    expect(plain(screen.getByTestId("agent-journal"))).toContain("Записей пока нет");
  });

  it("does not compare with the starting value of the automatic goal", () => {
    const { container } = render(<SummaryView model={summary({ goal: { mode: "auto", cso: 150_000, learned: false, current: 45_000, status: "within" } })} work={work()} />);
    const text = plain(container);
    expect(text).toContain("Цена обращения450 ₽Цену подбираем сами по вашим результатам");
    expect(text).not.toContain("1 500");
    expect(screen.queryByText("В цели")).toBeNull();
  });

  it("keeps the history in the journal: the owner's change and a decision, each with «Вернуть как было», the facts behind one disclosure", () => {
    render(<SummaryView model={summary()} work={work({ journal: [{ week: 2, from: "2026-10-26", to: "2026-11-01", entries: [decisionEntry, ownerEntry] }] })} />);
    const changes = screen.getAllByTestId("journal-change");
    expect(changes.map((c) => plain(c.querySelector(".log-change-text")))).toEqual(["Отключил объявление «Маникюр без записи»", "Вы: время показа — было Пн–Вс 10:00–20:00 → стало Пн–Вс 10:00–21:00"]);
    expect(screen.getAllByRole("button", { name: "Вернуть как было" })).toHaveLength(2);
    expect(changes[1]?.querySelector("details")).toBeNull();
    fireEvent.click(screen.getByText("Факты"));
    expect(plain(changes[0] ?? null)).toContain("Объявление «Маникюр без записи»: расход за 14 дней1 530 ₽");
    expect(screen.getByRole("link", { name: "Как сервис принял это решение" })).toHaveAttribute("href", "/history/turn/t1");
    fireEvent.click(screen.getAllByRole("button", { name: "Вернуть как было" })[0] as HTMLElement);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("marks both sides of the running check and offers to switch a paused ad back on", () => {
    const ad = { id: "a1", directionId: "d1", title: "Маникюр у метро", text: "Маникюр с покрытием от 1 800 ₽", channel: "search" as const, verdict: "effective" as const, fresh: false, pending: false, checking: true, clicks: 120, leads: 6, change: null };
    render(<SummaryView model={summary()} work={work({ shown: [ad, { ...ad, id: "a3", text: "Маникюр с покрытием: −15% на первый визит" }], hidden: [{ id: "a2", title: "Маникюр без записи", paused: true }] })} />);
    expect(screen.getAllByText("В проверке")).toHaveLength(2);
    expect(screen.getByTestId("ads-effective").textContent).toContain("Приводят клиентов · 2");
    expect(screen.getAllByRole("button", { name: /изменить текст/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /: отключить/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Маникюр без записи: включить" })).toBeTruthy();
  });

  it("names the training market only in the comparison line of a simulation", () => {
    const sim = { comparison: { service: [3, 6], baseline: [3, 5], serviceNow: { spend: 100_000, leads: 6, costPerLead: 16_667 }, baselineNow: { spend: 100_000, leads: 5, costPerLead: 20_000 } }, result: null, decisionDays: [2], day: 3, totalDays: 30, scenarioTitle: "Обычный месяц", ended: false };
    const { container } = render(<SummaryView model={summary({ simulation: { weeks: 1 } })} work={work({ sim })} />);
    expect(plain(screen.getByTestId("sim-comparison"))).toContain("За 2 дня: с сервисом 6 обращений, без него было бы 5пока рано сравнивать");
    expect(plain(container).match(/учебн/gi)).toBeNull();
  });
});

describe("AdvertiserDataNotice", () => {
  it("explains the marking requirement and retries the launch on «Готово»", () => {
    const onDone = vi.fn();
    render(<AdvertiserDataNotice onDone={onDone} />);
    expect(screen.getByText("Яндексу нужны данные о вашем бизнесе для маркировки рекламы")).toBeTruthy();
    screen.getByRole("button", { name: "Готово" }).click();
    expect(onDone).toHaveBeenCalledOnce();
  });
});
