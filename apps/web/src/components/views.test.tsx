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
  budgetPlan: 1_306_452,
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
  recentChanges: [],
  changesLast7: 0,
  nextCheck: null,
  cso: 100_000,
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
    expect(screen.queryAllByTestId("chart-no-leads")).toHaveLength(0);
  });

  it("marks days that spent without leads instead of hiding them, up to the last reported day", () => {
    const { container } = render(
      <SummaryView
        model={summary({
          daily: [
            { date: "2026-10-23", leads: null, spend: 0, decision: false },
            { date: "2026-10-24", leads: 2, spend: 120_000, decision: false },
            { date: "2026-10-25", leads: 0, spend: 50_000, decision: false },
            { date: "2026-10-26", leads: 3, spend: 120_000, decision: false },
            { date: "2026-10-27", leads: 0, spend: 40_000, decision: false },
          ],
        })}
        work={work()}
      />,
    );
    expect(screen.getAllByTestId("chart-no-leads")).toHaveLength(2);
    expect(plain(container.querySelector(".spark-axis"))).toBe("24 октября без обращений27 октября");
    // Two single days with leads around a day without them: no line drawn across the gap.
    expect(container.querySelectorAll(".spark-line")).toHaveLength(0);
    expect(container.querySelectorAll(".spark-point")).toHaveLength(1);
  });

  const hintDays = [
    { date: "2026-10-24", leads: 2, spend: 120_000, decision: false },
    { date: "2026-10-25", leads: 0, spend: 61_000, decision: false },
    { date: "2026-10-26", leads: 3, spend: 124_200, decision: false },
  ];

  it("tells a day's price and leads under the pointer and hides the hint when it leaves", () => {
    const { container } = render(<SummaryView model={summary({ daily: hintDays })} work={work()} />);
    const plot = container.querySelector(".spark-plot") as HTMLElement;
    expect(screen.queryByTestId("chart-hint")).toBeNull();
    // jsdom has no layout, so the pointer lands on the last day.
    fireEvent.pointerMove(plot, { clientX: 0 });
    expect(screen.getByTestId("chart-hint")).toHaveTextContent("26 октября · 414 ₽ за обращение · 3 обращения");
    expect(container.querySelector(".spark-guide")).not.toBeNull();
    fireEvent.pointerLeave(plot);
    expect(screen.queryByTestId("chart-hint")).toBeNull();
  });

  it("walks the chart's days with the arrow keys, a day without leads by its spend, and hides the hint on blur", () => {
    render(<SummaryView model={summary({ daily: hintDays })} work={work()} />);
    const chart = screen.getByRole("group", { name: /Цена обращения/ });
    fireEvent.focus(chart);
    expect(screen.getByTestId("chart-hint")).toHaveTextContent("26 октября · 414 ₽ за обращение · 3 обращения");
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByTestId("chart-hint")).toHaveTextContent("25 октября · без обращений · потрачено 610 ₽");
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByTestId("chart-hint")).toHaveTextContent("24 октября · 600 ₽ за обращение · 2 обращения");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByTestId("chart-hint")).toHaveTextContent("25 октября");
    fireEvent.blur(chart);
    expect(screen.queryByTestId("chart-hint")).toBeNull();
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

  it("puts the last change in one line with its day, its reason and an undo", () => {
    const last = { text: "Цена перехода +10%", date: "2026-10-26", reason: "С компьютеров получено 3 обращения по 414 ₽ при цели 1 000 ₽.", entryId: "e1", historyId: "c1", item: rollbackItem };
    render(<SummaryView model={summary()} work={work({ lastChange: last, recentChanges: [last] })} />);
    const line = screen.getByTestId("last-change");
    expect(plain(line)).toContain("вчераЦена перехода +10%Вернуть");
    expect(plain(line)).toContain("С компьютеров получено 3 обращения по 414 ₽ при цели 1 000 ₽.");
    expect(plain(line)).not.toMatch(/клик/i);
    fireEvent.click(within(line).getByRole("button", { name: "Вернуть как было: Цена перехода +10%" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("lists up to three service changes in «Что сделал сервис» beside the answer", () => {
    const change = (id: string, text: string, date: string) => ({ text, date, reason: `Причина ${id}.`, entryId: null, historyId: id, item: { ...rollbackItem, id } });
    const recent = [change("c1", "Цена перехода +10%", "2026-10-27"), change("c2", "Лимит 1 077 ₽", "2026-10-26"), change("c3", "Пауза объявления", "2026-10-20")];
    render(<SummaryView model={summary()} work={work({ lastChange: recent[0] ?? null, recentChanges: recent, changesLast7: 2 })} />);
    const side = screen.getByTestId("service-changes");
    expect(within(side).getByRole("heading", { name: "Что сделал сервис" })).toBeTruthy();
    expect(within(side).getAllByTestId("service-change").map((c) => plain(c.querySelector(".brief-what")))).toEqual(["Цена перехода +10%", "Лимит 1 077 ₽", "Пауза объявления"]);
    expect(plain(within(side).getAllByTestId("service-change")[2] ?? null)).toContain("20 октября");
    fireEvent.click(within(side).getByRole("button", { name: /Вся история/ }));
    expect(screen.getByTestId("agent-journal")).toBeTruthy();
  });

  it("has no «Что сделал сервис» before the first change", () => {
    render(<SummaryView model={summary()} work={work()} />);
    expect(screen.queryByTestId("service-changes")).toBeNull();
    expect(screen.queryByTestId("last-change")).toBeNull();
  });

  it("counts the service's changes of the week on the «История» row", () => {
    render(<SummaryView model={summary()} work={work({ changesLast7: 3 })} />);
    expect(plain(screen.getByTestId("history-count"))).toContain("3 изменения за неделю");
  });

  it("says whether the ads run, with how many are shown", () => {
    render(<SummaryView model={summary()} work={work({ shown: [ad(), ad({ id: "a3" })] })} />);
    expect(plain(screen.getByTestId("ads-state"))).toBe("идёт · 2 объявления");
  });

  it("says the ads are paused or wait for Yandex", () => {
    const { unmount } = render(<SummaryView model={summary({ state: "paused" })} work={work({ shown: [ad()] })} />);
    expect(plain(screen.getByTestId("ads-state"))).toBe("на паузе");
    unmount();
    render(<SummaryView model={summary({ state: "first_day", moderation: { pending: 2, accepted: 0, rejected: 0 } })} work={work()} />);
    expect(plain(screen.getByTestId("ads-state"))).toBe("на проверке Яндекса");
  });

  it("marks a price under one's own goal green and leaves a reference without a mark", () => {
    const { unmount } = render(<SummaryView model={summary({ goal: { mode: "user", cso: 100_000, learned: false, current: 51_200, status: "within" } })} work={work()} />);
    expect(plain(screen.getByTestId("goal-badge"))).toBe("дешевле цели на 48%");
    unmount();
    render(<SummaryView model={summary({ goal: { mode: "auto", cso: 100_000, learned: false, current: 51_200, status: "within" } })} work={work()} />);
    expect(screen.queryByTestId("goal-badge")).toBeNull();
  });

  it("marks the even pace of the month on the budget bar", () => {
    render(<SummaryView model={summary({ monthBudget: 3_000_000, spentMonth: 614_600, budgetPlan: 900_000 })} work={work()} />);
    const plan = screen.getByTestId("budget-plan");
    expect(plan).toHaveStyle({ left: "30%" });
    expect(plain(plan)).toContain("план 9 000 ₽");
    expect(screen.getByTestId("budget-bar").querySelector("i")).toHaveStyle({ width: "20.486666666666668%" });
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
    expect(sheet).toHaveTextContent("Работают хорошо · 2");
    // The group says its rule in rubles of the goal (here 1 000 ₽), not «клиенты».
    expect(plain(sheet)).toContain("3 обращения и больше, в среднем не дороже 700 ₽");
    expect(plain(sheet)).not.toMatch(/клиент/i);
    expect(plain(within(sheet).getAllByTestId("ad-stats")[0] ?? null)).toBe("потрачено 1 200 ₽ · 6 обращений по 200 ₽");
    expect(plain(within(sheet).getAllByTestId("shown-ad")[0] ?? null)).toContain("nogotok.example · поиск");
    expect(screen.getByTestId("hidden-ads")).toHaveTextContent("Маникюр без записи");
    // A touch screen opens the actions from one button.
    fireEvent.click(screen.getAllByRole("button", { name: "Маникюр у метро: действия" })[0] as HTMLElement);
    expect(await screen.findByRole("menuitem", { name: "Изменить текст" })).toBeTruthy();
    // A mouse has them in the card itself.
    fireEvent.click(screen.getAllByRole("button", { name: "Маникюр у метро: изменить текст" })[0] as HTMLElement);
    expect(screen.getByLabelText("Маникюр у метро: заголовок")).toBeTruthy();
  });

  it("says when an ad brought no leads", () => {
    render(<SummaryView model={summary()} work={work({ shown: [ad({ leads: 0, spend: 61_000, costPerLead: null, verdict: "learning" })] })} />);
    fireEvent.click(screen.getByRole("button", { name: /Объявления/ }));
    expect(plain(screen.getByTestId("ad-stats"))).toBe("потрачено 610 ₽ · обращений нет");
  });

  it("opens the history sheet with changes, rollback, facts and the turn", () => {
    render(<SummaryView model={summary()} work={work({ journal: [{ week: 2, from: "2026-10-26", to: "2026-11-01", entries: [decisionEntry, ownerEntry] }] })} />);
    fireEvent.click(screen.getByRole("button", { name: /История/ }));
    const journal = screen.getByTestId("agent-journal");
    expect(plain(within(journal).getByTestId("client-cost"))).toBe("Клиенты · 7 · 900 ₽ за клиента");
    const changes = within(journal).getAllByTestId("journal-change");
    // Newest first: the owner's change of 28 October above the decision of 27 October.
    expect(changes.map((c) => plain(c.querySelector(".log-change-text")))).toEqual([
      "Вы: время показа — было Пн–Вс 10:00–20:00 → стало Пн–Вс 10:00–21:00",
      "Отключил объявление «Маникюр без записи»",
    ]);
    expect(within(journal).getAllByRole("button", { name: "Вернуть как было" })).toHaveLength(2);
    expect(within(journal).getByRole("region", { name: "Неделя 2" })).toBeTruthy();
    fireEvent.click(within(journal).getByText("Факты"));
    expect(plain(changes[1] ?? null)).toContain("Объявление «Маникюр без записи»: расход за 14 дней1 530 ₽");
    expect(within(journal).getByRole("link", { name: "Как сервис принял это решение" })).toHaveAttribute("href", "/history/turn/t1");
    fireEvent.click(within(journal).getAllByRole("button", { name: "Вернуть как было" })[0] as HTMLElement);
    expect(screen.getByText("Вернуть как было?")).toBeTruthy();
  });

  it("reads the history newest first, with «Раньше» at the bottom", () => {
    const section = (week: number, from: string) => ({ week, from, to: from, entries: [{ ...decisionEntry, id: `${from}:day`, date: from }] });
    const journal = Array.from({ length: 10 }, (_, i) => section(i + 1, `2026-10-${String(i + 1).padStart(2, "0")}`));
    render(<SummaryView model={summary()} work={work({ journal })} />);
    fireEvent.click(screen.getByRole("button", { name: /История/ }));
    const sheet = screen.getByTestId("agent-journal");
    const weeks = within(sheet).getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(weeks).toEqual(["Неделя 10", "Неделя 9", "Неделя 8", "Неделя 7", "Неделя 6", "Неделя 5", "Неделя 4", "Неделя 3"]);
    expect(sheet.lastElementChild).toHaveTextContent("Раньше");
    fireEvent.click(within(sheet).getByRole("button", { name: "Раньше" }));
    expect(within(sheet).getAllByRole("region").at(-1)).toHaveAttribute("aria-label", "Неделя 1");
  });

  it("names the period of the numbers and the simulated day", () => {
    const { unmount } = render(<SummaryView model={summary()} work={work()} />);
    expect(plain(screen.getByTestId("data-period"))).toBe("1–27 октября");
    unmount();
    const sim = { comparison: null, result: null, decisionDays: [], day: 9, totalDays: 30, scenarioTitle: "Обычный месяц", ended: false };
    render(<SummaryView model={summary({ simulation: { weeks: 1 } })} work={work({ sim })} />);
    expect(screen.getByText("симуляция · день 9 из 30")).toBeTruthy();
  });

  it("explains a reference behind its words", () => {
    render(<SummaryView model={summary({ goal: { mode: "auto", cso: 100_000, learned: false, current: 51_200, status: "within" } })} work={work()} />);
    fireEvent.click(screen.getByTestId("goal-term"));
    expect(screen.getByText(/бюджет месяца, делённый на 30/)).toBeTruthy();
  });

  it("titles the chart as the price of a lead by day", () => {
    const daily = ["2026-10-25", "2026-10-26", "2026-10-27"].map((date) => ({ date, leads: 2, spend: 60_000, decision: false }));
    render(<SummaryView model={summary({ daily })} work={work()} />);
    expect(screen.getByTestId("cost-chart")).toHaveTextContent("цена обращения по дням");
  });

  it("says what the service does next: the nearest check, or tomorrow morning's look", () => {
    const nextCheck = { statement: "Проверяю, останется ли стоимость обращений с компьютеров ниже цели.", checkOn: "2026-11-03", more: 1 };
    const { unmount } = render(<SummaryView model={summary()} work={work({ nextCheck })} />);
    expect(plain(screen.getByTestId("next-step"))).toBe("Дальше3 ноября сервис проверит, останется ли стоимость обращений с компьютеров ниже цели · ещё 1 проверка");
    unmount();
    const { unmount: again } = render(<SummaryView model={summary()} work={work()} />);
    expect(plain(screen.getByTestId("next-step"))).toBe("Дальшезавтра утром сервис снова посмотрит рекламу");
    again();
    // Nothing to promise on a pause or before the first data.
    const { unmount: paused } = render(<SummaryView model={summary({ state: "paused" })} work={work()} />);
    expect(screen.queryByTestId("next-step")).toBeNull();
    paused();
    render(<SummaryView model={summary({ state: "first_day" })} work={work()} />);
    expect(screen.queryByTestId("next-step")).toBeNull();
  });

  it("calls an unchecked counter a counter", () => {
    render(<SummaryView model={summary({ measurement: { status: "unchecked", counterId: null, simulated: false } })} work={work()} />);
    expect(screen.getByTestId("brief-exception")).toHaveTextContent("Счётчик не проверен");
  });

  it("names the morning a week was reviewed and writes a day's date once", () => {
    const launch = { ...ownerEntry, id: "h:launch", date: "2026-11-01", day: 1, changes: [{ ...ownerEntry.changes[0]!, text: "Вы: реклама запущена" }] };
    const firstReview = { ...decisionEntry, id: "2026-11-01:day", date: "2026-11-01", day: 1, changes: [] };
    const weekReview = { ...decisionEntry, id: "2026-11-09:week", date: "2026-11-09", day: 9, weekly: true, changes: [] };
    render(<SummaryView model={summary()} work={work({ journal: [{ week: 1, from: "2026-11-01", to: "2026-11-08", entries: [launch, firstReview, weekReview] }] })} />);
    fireEvent.click(screen.getByRole("button", { name: /История/ }));
    const sheet = screen.getByTestId("agent-journal");
    expect(plain(within(sheet).getByTestId("journal-week"))).toBe("Неделя 1 · 1 ноября — 8 ноября · разбор 9 ноября");
    expect(within(sheet).getAllByText("День 1 · 1 ноября")).toHaveLength(1);
  });

  it("opens the history sheet from #history", () => {
    window.location.hash = "#history";
    render(<SummaryView model={summary()} work={work()} />);
    expect(screen.getByTestId("agent-journal")).toBeTruthy();
    window.location.hash = "";
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
