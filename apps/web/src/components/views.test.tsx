import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExperimentItem } from "@/lib/experiments-model";
import type { HistoryItem } from "@/lib/history-view";
import type { InsightCardModel, InsightFeedModel } from "@/lib/insights-model";
import type { SummaryModel } from "@/lib/summary-model";
import { SummaryView } from "./summary/SummaryView";
import { AdvertiserDataNotice } from "./wizard/LaunchStep";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/summary", useSearchParams: () => new URLSearchParams() }));

const running: ExperimentItem = {
  id: "e1",
  hypothesis: "Проверяем, приведёт ли «−15% на первый визит» больше записей, чем цена",
  direction: "Маникюр — Поиск",
  startedOn: "2026-10-20",
  day: 8,
  status: "running",
  outcome: null,
  control: { title: "Маникюр у метро", text: "Маникюр с покрытием от 1 800 ₽", clicks: 120, leads: 6, spend: 300_000, active: true },
  variant: { title: "Маникюр у метро", text: "Маникюр с покрытием: −15% на первый визит", clicks: 110, leads: 9, spend: 280_000, active: true },
};

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

const plain = (node: { textContent: string | null } | null): string => node?.textContent?.replace(/[\u00a0\u202f]/g, " ") ?? "";

describe("SummaryView", () => {
  it("shows three numbers without charts or a ring, then the insight feed instead of the week's actions", () => {
    const { container } = render(<SummaryView model={summary()} />);
    const text = plain(container);
    expect(text).toContain("Цель: до 300 ₽ за обращение · Сейчас: 340 ₽");
    expect(text).toContain("дороже цели");
    expect(container.querySelectorAll(".kpi")).toHaveLength(3);
    expect(container.querySelector(".ring, svg[role=img]")).toBeNull();
    expect(text).not.toContain("Что сервис сделал за неделю");
    expect(text).toMatch(/клиентами/);
    // The day's review with its insight in four parts.
    const day = screen.getByTestId("day-review");
    expect(plain(day)).toContain("Разбор 27 октября");
    expect(plain(day)).toContain("Отключили одно объявление: оно тратило деньги без обращений.");
    const insight = plain(screen.getByTestId("insight"));
    for (const part of ["Сервис", "Что заметили", "На каких данных", "Объявление «Маникюр без записи»: расход за 14 дней", "1 530 ₽", "Что решили", "Применено", "Что дальше"]) {
      expect(insight).toContain(part);
    }
    expect(screen.getByRole("button", { name: /Вернуть как было/ })).toBeTruthy();
    expect(container).toMatchSnapshot();
  });

  it("opens the numbers by platform by a link, not on the first screen", () => {
    const { container } = render(<SummaryView model={summary()} />);
    expect(plain(container)).not.toContain("Где показываем рекламу");
    fireEvent.click(screen.getByRole("button", { name: /Цифры по площадкам/ }));
    expect(plain(screen.getByTestId("platforms"))).toContain("3 объявления · лимит 2 100 ₽ в неделю");
    expect(plain(screen.getByTestId("platforms"))).toContain("Поиск Яндекса");
  });

  it("shows the hint instead of an invented cost per client", () => {
    const { container } = render(
      <SummaryView model={summary({ clientCost: { kind: "unknown", costPerLead: 57_273, hint: "Ответьте, сколько обращений стали клиентами, чтобы видеть стоимость клиента", week: "2026-10-19" } })} />,
    );
    expect(container.textContent).toContain("Ответьте, сколько обращений стали клиентами, чтобы видеть стоимость клиента");
  });

  it("shows the cost per lead with the goal and its status when there are no clients answers", () => {
    render(<SummaryView model={summary({ clientCost: { kind: "unknown", costPerLead: 34_000, hint: "", week: "2026-10-19" }, attention: { notifications: [], clientsQuestion: null } })} />);
    expect(plain(screen.getByTestId("goal-line"))).toBe("Цель: до 300 ₽");
    expect(screen.getByText("Дороже цели")).toBeTruthy();
  });

  it("asks about clients in the cost tile only while the question is open", () => {
    const hint = "Ответьте, сколько обращений стали клиентами, чтобы видеть стоимость клиента";
    const { container } = render(
      <SummaryView model={summary({ clientCost: { kind: "unknown", costPerLead: 17_700, hint, week: "2026-10-19" }, attention: { notifications: [], clientsQuestion: null } })} />,
    );
    expect(container.textContent).not.toContain(hint);
    expect(container.textContent).toContain("за 7 дней");
  });

  it("explains a short launch month and does not compare with the time before the launch", () => {
    const { container } = render(
      <SummaryView model={summary({ compare: false, launchedDays: 3, launchMonth: { budget: 96_700, monthName: "октября", nextMonthName: "ноября" }, monthBudget: 96_700 })} />,
    );
    const text = plain(container);
    expect(text).toContain("До конца октября — 967 ₽, с 1 ноября — 15 000 ₽ в месяц");
    expect(text).toContain("С запуска · 3 дня");
    expect(text).not.toContain("в прошлом периоде");
  });

  it("keeps offering to skip to the first decision in a simulation until the service has decided something", () => {
    const quiet = feed({ days: [{ date: "2026-11-02", from: null, summary: "Данных пока мало.", quiet: true, rulesReason: null, insights: [], weekly: null }] });
    render(<SummaryView model={summary({ simulation: { secondsPerDay: 10 }, launchedDays: 3, compare: false, decided: false, feed: quiet, attention: { notifications: [], clientsQuestion: null } })} />);
    expect(screen.getByRole("button", { name: /Перемотать до первого решения/ })).toBeTruthy();
    expect(plain(screen.getByTestId("quiet-day"))).toBe("Посмотрели рекламу — менять ничего не нужноДанных пока мало.");
    expect(document.body.textContent).not.toContain("Яндекс иногда пересчитывает");
  });

  it("says that the rules decided alone that day and why", () => {
    const ruleCard: InsightCardModel = { ...pauseCard, id: "i2", author: "rule", rollback: null };
    const day = { date: "2026-10-27", from: null, summary: null, quiet: false, rulesReason: "Сегодня решения принимали страховочные правила: помощник был недоступен", insights: [ruleCard], weekly: null };
    render(<SummaryView model={summary({ feed: feed({ days: [day] }) })} />);
    expect(screen.getByTestId("rules-day").textContent).toBe("Сегодня решения принимали страховочные правила: помощник был недоступен");
    expect(screen.getByTestId("insight").textContent).toContain("Сервис, страховочное правило");
    expect(screen.queryByRole("button", { name: /Вернуть как было/ })).toBeNull();
  });

  it("says when the first review comes while there are no reviews yet, and not later on", () => {
    const { unmount } = render(<SummaryView model={summary({ launchedDays: 1, compare: false, feed: feed({ days: [] }), decided: false })} />);
    expect(plain(screen.getByTestId("summary-feed"))).toContain("первый разбор — завтра утром");
    unmount();
    render(<SummaryView model={summary({ feed: feed({ days: [] }) })} />);
    expect(plain(screen.getByTestId("summary-feed"))).toContain("За этот период разборов не было");
    expect(plain(screen.getByTestId("summary-feed"))).not.toContain("первый разбор");
  });

  it("shows «Разбор недели» with «Выяснили» and «Проверяем» (insights spec «Разбор недели в ленте»)", () => {
    const monday = {
      date: "2026-11-09",
      from: null,
      summary: null,
      quiet: true,
      rulesReason: null,
      insights: [],
      weekly: {
        summary: "За неделю подтвердили, что с телефонов клиенты обходятся дороже.",
        found: [{ id: "h1", statement: "С телефонов клиенты обходятся дороже", check: "Сравним цену обращения", checkOn: "2026-11-09", outcome: "подтвердилась", result: "Цена обращения снизилась." }],
        checking: [{ id: "h2", statement: "Запросы со словом «обучение» не приводят клиентов", check: "Сравним цену обращения", checkOn: "2026-11-18", outcome: null, result: null }],
        insights: [],
      },
    };
    render(<SummaryView model={summary({ feed: feed({ days: [monday] }) })} />);
    const weekly = plain(screen.getByTestId("weekly-review"));
    expect(weekly).toContain("Разбор недели");
    expect(weekly).toContain("За неделю подтвердили, что с телефонов клиенты обходятся дороже.");
    expect(plain(screen.getByTestId("weekly-found"))).toBe("С телефонов клиенты обходятся дорожеПодтвердилась: Цена обращения снизилась.");
    expect(plain(screen.getByTestId("weekly-checking"))).toBe("Запросы со словом «обучение» не приводят клиентовСравним цену обращения — к 18 ноября");
  });

  it("shows the days the rules decided alone as one line with the reason", () => {
    const line = { date: "2026-11-30", from: "2026-11-04", summary: null, quiet: false, rulesReason: "Решения принимали страховочные правила: лимит расходов на помощника исчерпан", insights: [], weekly: null };
    render(<SummaryView model={summary({ feed: feed({ days: [line] }) })} />);
    const day = plain(screen.getByTestId("day-review"));
    expect(day).toContain("С 4 ноября по 30 ноября");
    expect(day).toContain("Решения принимали страховочные правила: лимит расходов на помощника исчерпан");
  });

  it("speaks of the simulation, not of Yandex, and offers to skip to the first decision", () => {
    const { container } = render(
      <SummaryView model={summary({ state: "first_day", simulation: { secondsPerDay: 10 }, spentMonth: 0, decided: false, feed: feed({ days: [] }), attention: { notifications: [], clientsQuestion: null } })} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Симуляция запущена");
    expect(text).toContain("около минуты");
    expect(text).not.toMatch(/Яндекс проверяет|проверку Яндекса|в вашем Яндекс Директе|в течение суток|пересчитывает/);
    expect(screen.getByRole("button", { name: /Перемотать до первого решения/ })).toBeTruthy();
  });

  it("shows the launch state and the month budget on the first day, without the period switch and empty blocks", () => {
    const { container } = render(
      <SummaryView model={summary({ state: "first_day", spentMonth: 0, monthBudget: 145_100, feed: feed({ days: [] }), moderation: { pending: 3, accepted: 0, rejected: 0 }, attention: { notifications: [], clientsQuestion: null } })} />,
    );
    const text = plain(container);
    expect(text).toContain("Первые результаты появятся в течение суток");
    expect(plain(screen.getByTestId("first-day-budget"))).toBe("Потрачено 0 ₽ из 1 451 ₽ в этом месяце — больше не потратим");
    expect(screen.queryByText("Неделя")).toBeNull();
    expect(text).not.toContain("Нужно ваше участие");
  });

  it("does not compare with the starting value of the automatic goal", () => {
    const { container } = render(<SummaryView model={summary({ goal: { mode: "auto", cso: 150_000, learned: false, current: 45_000, status: "within" } })} />);
    const text = plain(container);
    expect(text).toContain("Цену обращения подбираем сами по вашим результатам · Сейчас: 450 ₽ за обращение");
    expect(text).not.toContain("1 500");
    expect(screen.queryByText("В цели")).toBeNull();
  });

  it("shows the running check first in the feed as «Сейчас проверяем» in plain words", () => {
    render(<SummaryView model={summary({ feed: feed({ check: { item: running, minDays: 7, maxDays: 21, minClicks: 100 } }) })} />);
    expect(screen.getByTestId("insight-feed").firstElementChild?.getAttribute("data-testid")).toBe("experiment");
    expect(screen.getByText("Сейчас проверяем")).toBeTruthy();
    expect(screen.getByText(/Проверяем, приведёт ли «−15% на первый визит»/)).toBeTruthy();
    // Both texts are shown, with what differs highlighted.
    expect([...document.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(expect.arrayContaining(["−15%", "визит"]));
    expect(document.body.textContent).not.toMatch(/CTR|конверси|ставк|CPC|CPA/i);
    expect(screen.queryByText(/отключено/)).toBeNull();
  });

  it("marks a side of the check that was paused during it because it brought no clients", () => {
    const paused = { ...running, control: { ...running.control, leads: 0, active: false } };
    render(<SummaryView model={summary({ feed: feed({ check: { item: paused, minDays: 7, maxDays: 21, minClicks: 100 } }) })} />);
    expect(screen.getByTestId("experiment").textContent).toContain("отключено — не приводило клиентов");
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
