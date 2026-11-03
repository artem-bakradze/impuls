import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HistoryItem } from "@/lib/history-view";
import type { InsightCardModel, InsightFeedModel } from "@/lib/insights-model";
import type { AdsWork } from "@/lib/server/simulation-screen";
import type { ShownAd } from "@/lib/service-work";
import type { SummaryModel } from "@/lib/summary-model";
import { SummaryView } from "./summary/SummaryView";
import { AdvertiserDataNotice } from "./wizard/LaunchStep";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/summary", useSearchParams: () => new URLSearchParams() }));

const rollbackItem: HistoryItem = {
  id: "c1",
  at: "2026-10-26T06:00:00Z",
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
  dataPeriod: { from: "2026-10-01", to: "2026-10-27", asOf: "2026-10-27T09:00:00Z", month: "2026-10", previousPartial: false },
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
  attention: { notifications: [], clientsQuestion: null },
  directions: [{ id: "d1", name: "Маникюр — Поиск", channel: "search", status: "active", ads: 3, weeklyLimit: 210_000, spend: 630_000, leads: 11, costPerLead: 57_273 }],
  ...overrides,
});

const plain = (node: { textContent: string | null } | null): string => node?.textContent?.replace(/[\u00a0\u202f]/g, " ") ?? "";

const ad = (overrides: Partial<ShownAd> = {}): ShownAd => ({
  id: "a1",
  directionId: "d1",
  title: "Маникюр у метро",
  text: "Маникюр с покрытием от 1 800 ₽",
  channel: "search",
  verdict: "effective",
  fresh: false,
  pending: false,
  checking: false,
  clicks: 120,
  leads: 6,
  impressions: 1_240,
  spend: 120_000,
  costPerLead: 20_000,
  change: null,
  ...overrides,
});

const work = (overrides: Partial<AdsWork> = {}): AdsWork => ({
  shown: [],
  hidden: [],
  directionChanges: [],
  journal: [],
  brief: null,
  lastChange: null,
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

describe("«Реклама» — один ответ (analytics spec «Сводка»)", () => {
  it("shows the price of a lead with its goal, the leads and the budget, and keeps ads and history off the page", () => {
    const { container } = render(<SummaryView model={summary()} work={work()} />);
    expect(screen.getByTestId("brief")).toBeTruthy();
    expect(plain(screen.getByTestId("goal-line"))).toBe("за обращение · цель 300 ₽");
    expect(container.querySelector(".brief-number")).toHaveTextContent("340 ₽");
    expect(container.querySelector(".brief-number")).toHaveAttribute("data-tone", "danger");
    expect(plain(screen.getByTestId("budget-tile"))).toContain("6 300 ₽из 15 000 ₽");
    expect(screen.queryByTestId("shown-ads")).toBeNull();
    expect(screen.queryByTestId("agent-journal")).toBeNull();
    expect(screen.getByRole("button", { name: /Объявления/ })).toHaveTextContent("0");
  });

  it("draws one cost-per-lead trend against the goal, and none without reports", () => {
    render(
      <SummaryView
        model={summary({
          daily: [
            { date: "2026-10-24", leads: 2, spend: 120_000, decision: false },
            { date: "2026-10-25", leads: 1, spend: 50_000, decision: false },
            { date: "2026-10-26", leads: 3, spend: 120_000, decision: false },
          ],
        })}
        work={work()}
      />,
    );
    expect(screen.getByTestId("cost-chart")).toBeTruthy();
  });

  it("hides the trend until there are two days with leads", () => {
    render(<SummaryView model={summary({ daily: [{ date: "2026-10-24", leads: 2, spend: 120_000, decision: false }] })} work={work()} />);
    expect(screen.queryByTestId("cost-chart")).toBeNull();
  });

  it("calls the automatic goal an orienting point and does not colour the price as a failure", () => {
    const { container } = render(
      <SummaryView model={summary({ goal: { mode: "auto", cso: 150_000, learned: false, current: 45_000, status: "within" } })} work={work()} />,
    );
    expect(plain(screen.getByTestId("goal-line"))).toBe("за обращение · ориентир 1 500 ₽");
    expect(container.querySelector(".brief-number")).not.toHaveAttribute("data-tone");
    expect(container.querySelector(".brief-number")).toHaveTextContent("450 ₽");
  });

  it("puts the last change in one line with its day and an undo", () => {
    render(
      <SummaryView
        model={summary()}
        work={work({ lastChange: { text: "Цена клика +10%", date: "2026-10-26", entryId: "e1", historyId: "c1", item: rollbackItem } })}
      />,
    );
    const line = screen.getByTestId("last-change");
    expect(plain(line)).toContain("вчераЦена клика +10%Вернуть");
    fireEvent.click(screen.getByRole("button", { name: "Вернуть" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows the first day as a word and a promise, without the old timeline", () => {
    render(
      <SummaryView
        model={summary({ state: "first_day", spentMonth: 0, goal: { mode: "auto", cso: 30_000, learned: false, current: null, status: "no_data" }, moderation: { pending: 3, accepted: 0, rejected: 0 } })}
        work={work()}
      />,
    );
    const first = screen.getByTestId("first-day");
    expect(first).toHaveTextContent("Запуск");
    expect(first).toHaveTextContent("проверка Яндекса · первые данные завтра");
    expect(first).not.toHaveTextContent("Первые результаты появятся в течение суток");
    expect(screen.queryByTestId("agent-journal")).toBeNull();
  });

  it("puts one exception in place of the change: a pause with resume", () => {
    render(<SummaryView model={summary({ state: "paused" })} work={work()} />);
    const line = screen.getByTestId("brief-exception");
    expect(plain(line)).toContain("Реклама на паузеВозобновить");
  });

  it("puts one exception in place of the change: the clients question, one tap deep", () => {
    render(<SummaryView model={summary({ attention: { notifications: [], clientsQuestion: { week: "2026-10-19", weekEnd: "2026-10-25", leads: 11 } } })} work={work()} />);
    expect(screen.getByTestId("brief-exception")).toHaveTextContent("1 вопрос");
    fireEvent.click(screen.getByRole("button", { name: "Ответить" }));
    expect(screen.getByTestId("clients-question")).toBeTruthy();
    expect(screen.getByText("Сколько клиентов?")).toBeTruthy();
  });

  it("puts one exception in place of the change: an unchecked counter links to settings", () => {
    render(<SummaryView model={summary({ measurement: { status: "not_found", counterId: null, simulated: false } })} work={work()} />);
    expect(screen.getByTestId("brief-exception")).toHaveTextContent("Счётчик не найден");
    expect(screen.getByRole("link", { name: "Настроить" })).toHaveAttribute("href", "/settings#site");
  });

  it("opens the ads sheet with money, one group per estimate and actions behind a menu", async () => {
    render(
      <SummaryView
        model={summary()}
        work={work({
          shown: [ad(), ad({ id: "a3", text: "Маникюр с покрытием: −15% на первый визит", spend: 80_000, costPerLead: 40_000 })],
          hidden: [{ id: "a2", title: "Маникюр без записи", paused: true }],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Объявления/ }));
    const sheet = screen.getByTestId("shown-ads");
    expect(within(sheet).getAllByTestId("shown-ad")).toHaveLength(2);
    expect(sheet).toHaveTextContent("Приводят клиентов · 2");
    expect(plain(sheet)).toContain("1 200 ₽ · 6 обращений · 200 ₽");
    expect(screen.getByTestId("hidden-ads")).toHaveTextContent("Маникюр без записи");
    fireEvent.click(screen.getAllByRole("button", { name: "Маникюр у метро: действия" })[0] as HTMLElement);
    fireEvent.click(await screen.findByText("Изменить текст"));
    expect(screen.getByLabelText("Маникюр у метро: заголовок")).toBeTruthy();
  });

  it("opens the history sheet with changes, rollback, facts and the turn", () => {
    render(<SummaryView model={summary()} work={work({ journal: [{ week: 2, from: "2026-10-26", to: "2026-11-01", entries: [decisionEntry, ownerEntry] }] })} />);
    fireEvent.click(screen.getByRole("button", { name: /История/ }));
    const journal = screen.getByTestId("agent-journal");
    expect(plain(within(journal).getByTestId("client-cost"))).toBe("Клиенты · 7 · 900 ₽ за клиента");
    const changes = within(journal).getAllByTestId("journal-change");
    expect(changes.map((c) => plain(c.querySelector(".log-change-text")))).toEqual([
      "Отключил объявление «Маникюр без записи»",
      "Вы: время показа — было Пн–Вс 10:00–20:00 → стало Пн–Вс 10:00–21:00",
    ]);
    expect(within(journal).getAllByRole("button", { name: "Вернуть как было" })).toHaveLength(2);
    expect(within(journal).getByRole("region", { name: "Неделя 2" })).toBeTruthy();
    fireEvent.click(within(journal).getByText("Факты"));
    expect(plain(changes[0] ?? null)).toContain("Объявление «Маникюр без записи»: расход за 14 дней1 530 ₽");
    expect(within(journal).getByRole("link", { name: "Как сервис принял это решение" })).toHaveAttribute("href", "/history/turn/t1");
    fireEvent.click(within(journal).getAllByRole("button", { name: "Вернуть как было" })[0] as HTMLElement);
    expect(screen.getByText("Вернуть как было?")).toBeTruthy();
  });

  it("keeps the comparison with the control run in the history, not on the brief", () => {
    const sim = { comparison: { service: [3, 6], baseline: [3, 5], serviceNow: { spend: 100_000, leads: 6, costPerLead: 16_667 }, baselineNow: { spend: 100_000, leads: 5, costPerLead: 20_000 } }, result: null, decisionDays: [2], day: 3, totalDays: 30, scenarioTitle: "Обычный месяц", ended: false };
    const { container } = render(<SummaryView model={summary({ simulation: { weeks: 1 } })} work={work({ sim })} />);
    expect(screen.queryByTestId("sim-comparison")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /История/ }));
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
