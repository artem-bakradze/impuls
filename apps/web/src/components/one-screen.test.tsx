import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  imageId: null,
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

const form: SimulationStatus["form"] = {
  from: "2026-11-11",
  directions: [
    {
      id: "d1",
      name: "Автоматизация — Поиск",
      channel: "search",
      ads: [
        { id: "a1", title: "Автоматизация ресторанов доставки" },
        { id: "a2", title: "Интеграция с агрегаторами" },
      ],
      roomRub: { 1: 600, 3: 1_800, 7: 4_200, 14: 8_400 },
    },
  ],
};

const status = (overrides: Partial<SimulationStatus> = {}): SimulationStatus => ({
  day: 11,
  at: "2026-11-11T06:00:00Z",
  timeZone: "Europe/Moscow",
  status: "paused",
  step: null,
  periods: 1,
  changes: 12,
  agentTurn: false,
  form,
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

const sim = { startedOn: "2026-11-01" };
const plain = (node: Element | null): string => node?.textContent?.replace(/[  ]/g, " ") ?? "";

describe("one «Реклама» in a simulation (simulation-mode spec «Симуляция как отдельный режим»)", () => {
  it("puts the assistant's review beside the answer and the player with «Добавить статистику» under the review", () => {
    const { container } = render(<SummaryView model={model()} work={work({ sim, lastChange: { text: "Цена перехода +10%", date: "2026-11-11", reason: null, entryId: review.id, historyId: "c1", item } })} simulation={status()} />);
    const player = screen.getByTestId("sim-player");
    expect(plain(player.querySelector("[data-testid=studio-day]"))).toBe("День 11");
    // Just the day: no «прожит», no «впереди».
    expect(screen.queryByTestId("studio-status")).toBeNull();
    expect(plain(player)).not.toMatch(/прожит|впереди|прерван/);
    // The run has no visible length and no days or weeks to press: the owner enters periods.
    expect(plain(player)).not.toMatch(/из 30|сценари/);
    expect(player.querySelector(".studio-strip")).toBeNull();
    expect(screen.getByTestId("studio-disclaimer")).toHaveTextContent("Учебный рынок · деньги не списываются");
    expect([...container.querySelectorAll(".studio-primary")].map((b) => b.textContent)).toEqual(["Добавить статистику"]);
    expect(screen.queryByRole("button", { name: /Прожить/ })).toBeNull();
    // The player is pressed where its result is read: in the review's column, right under the review.
    expect(player.parentElement?.className).toBe("brief-aside");
    expect(player.previousElementSibling).toBe(screen.getByTestId("review-rail"));
    // A demo has no real ads: no «Запустить по-настоящему» in the player (demo-login).
    expect(screen.queryByRole("button", { name: "Запустить по-настоящему" })).toBeNull();
    expect(screen.getByTestId("brief")).toBeTruthy();
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
  });

  it("names a period's review by its days", () => {
    const period: JournalEntry = { ...review, period: { from: "2026-11-04", to: "2026-11-10" } };
    render(<SummaryView model={model()} work={work({ sim, journal: [{ week: 2, period: true, from: "2026-11-04", to: "2026-11-10", entries: [period] }] })} simulation={status()} />);
    expect(screen.getByRole("heading", { level: 2, name: "Разбор · дни 4–10" })).toBeTruthy();
  });

  it("names days by their numbers, in its own lines and in the agent's words", () => {
    const expecting: JournalEntry = {
      ...review,
      paragraphs: ["Сохранил наблюдение и проверю результаты к 15 ноября."],
      checking: [{ statement: "Проверяю, останется ли стоимость обращений с компьютеров ниже цели.", checkOn: "2026-11-16" }],
    };
    const nextCheck = { statement: "Проверяю, останется ли стоимость обращений с компьютеров ниже цели.", checkOn: "2026-11-16", more: 0 };
    render(<SummaryView model={model()} work={work({ sim, nextCheck, journal: [{ week: 2, from: "2026-11-09", to: "2026-11-15", entries: [expecting] }] })} simulation={status()} />);
    expect(screen.queryByTestId("data-period")).toBeNull();
    expect(plain(screen.getByTestId("next-step"))).toBe("Дальшев день 16 сервис проверит, останется ли стоимость обращений с компьютеров ниже цели");
    const texts = [...screen.getByTestId("studio-review").querySelectorAll(".studio-msg-text")].map((p) => plain(p));
    expect(texts).toEqual(["Сохранил наблюдение и проверю результаты ко дню 15.", "В день 16 проверю, останется ли стоимость обращений с компьютеров ниже цели."]);
    expect(plain(document.body)).not.toMatch(/ноябр/);
  });

  it("types while the service reviews a period, with no way to send another", () => {
    render(<SummaryView model={model()} work={work({ sim })} simulation={status({ status: "stepping", step: { from: 11, to: 17 } })} />);
    expect(screen.getByRole("button", { name: "Сервис разбирает…" })).toBeDisabled();
    expect(screen.getByTestId("studio-thinking")).toHaveTextContent("Сервис разбирает дни 11–17…");
    expect(screen.getByRole("status", { name: "Сервис пишет разбор" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Разбирает статистику" })).toBeTruthy();
  });

  it("writes a review that arrives after a period part by part, and shows the one the page opened with at once", () => {
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

  it("promises the first review before the first statistics", () => {
    render(<SummaryView model={model({ state: "first_day", leads: { value: 0, previous: 0 }, spentMonth: 0 })} work={work({ sim, journal: [], shown: [] })} simulation={status({ day: 1, periods: 0, changes: 1 })} />);
    expect(screen.getByRole("button", { name: "Добавить статистику" })).toBeTruthy();
    expect(screen.getByText("Когда вы добавите статистику, я напишу здесь, что заметил в рекламе и что изменил.")).toBeTruthy();
    expect(screen.getByText("первые данные — после статистики")).toBeTruthy();
    expect(plain(document.body)).not.toContain("первые данные завтра");
  });

  it("has two actions in the player's menu and no real launch (simulation-mode «Без настоящего запуска»)", async () => {
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Ещё/ }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Начать заново", "Новая кампания"]);
    expect(screen.queryByText("Запустить по-настоящему")).toBeNull();
  });

  it("offers a new campaign in the player's menu, saying what goes and that the preparation starts again", async () => {
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Ещё/ }));
    fireEvent.click(await screen.findByText("Новая кампания"));
    expect((await screen.findAllByText("Начать новую кампанию?")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Вы заново пройдёте подготовку: сайт, описание бизнеса, бюджет и объявления/)).toBeTruthy();
  });

  it("starts over in one action, said without the words «модель» and «агент»", async () => {
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Ещё/ }));
    fireEvent.click(await screen.findByText("Начать заново"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Цифры и история симуляции удалятся, а реклама начнётся с первого дня с теми же объявлениями.");
    expect(dialog.textContent).not.toMatch(/модел|агент|Повторить этот прогон|Прогнать заново/i);
  });
});

describe("«Добавить статистику» (simulation-mode spec «Статистика периода от владельца»)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const open = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Добавить статистику" }));
    return screen.findByTestId("period-dialog");
  };
  const field = (title: string, label: string) => {
    const row = [...document.querySelectorAll<HTMLElement>("[data-testid=period-ad]")].find((r) => r.textContent?.startsWith(title));
    const input = [...(row?.querySelectorAll<HTMLElement>(".period-field") ?? [])].find((f) => f.querySelector("label")?.textContent === label)?.querySelector("input");
    if (!input) throw new Error(`No field ${label} of ${title}`);
    return input;
  };
  const type = (title: string, label: string, value: string) => fireEvent.change(field(title, label), { target: { value } });

  it("opens on a week from the current day, with the ads shown now and what Direct would spend", async () => {
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    await open();
    expect(screen.getByText("Статистика за дни 11–17")).toBeTruthy();
    expect(plain(screen.getByTestId("period-room"))).toBe("до 4 200 ₽ за 7 дней");
    expect([...document.querySelectorAll("[data-testid=period-ad] .period-ad-title")].map((t) => t.textContent)).toEqual(["Автоматизация ресторанов доставки", "Интеграция с агрегаторами"]);
    expect([...document.querySelectorAll("[data-testid=period-ad]")][0]?.querySelectorAll("label")).toHaveLength(4);
    fireEvent.click(screen.getByText("1 день"));
    expect(screen.getByText("Статистика за день 11")).toBeTruthy();
    expect(plain(screen.getByTestId("period-room"))).toBe("до 600 ₽ за 1 день");
  });

  it("says a mistake under its field and sends nothing", async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(status()) }));
    vi.stubGlobal("fetch", fetch);
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    await open();
    type("Автоматизация ресторанов доставки", "Показы", "50");
    type("Автоматизация ресторанов доставки", "Переходы", "60");
    type("Автоматизация ресторанов доставки", "Расход, ₽", "100");
    type("Интеграция с агрегаторами", "Переходы", "3");
    type("Интеграция с агрегаторами", "Показы", "40");
    type("Интеграция с агрегаторами", "Расход, ₽", "5000");
    fireEvent.click(screen.getByTestId("period-send"));
    expect(await screen.findByText("Переходов не может быть больше, чем показов")).toBeTruthy();
    expect(plain(screen.getByRole("alert"))).toBe("Директ потратит на это направление не больше 4 200 ₽ за 7 дней");
    expect(fetch.mock.calls.filter((call) => (call as unknown[])[1] !== undefined)).toEqual([]);
  });

  it("sends the period with empty fields as zeros and closes the window once the server took it", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/simulation" && init?.method === "POST" && typeof init.body === "string") posts.push(JSON.parse(init.body));
        const body = url === "/api/simulation" && init?.method === "POST" ? { jobId: "j1" } : url.startsWith("/api/jobs/") ? { state: "running" } : status();
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      }),
    );
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    await open();
    type("Автоматизация ресторанов доставки", "Показы", "1400");
    type("Автоматизация ресторанов доставки", "Переходы", "70");
    type("Автоматизация ресторанов доставки", "Расход, ₽", "1530");
    fireEvent.click(screen.getByTestId("period-send"));
    await waitFor(() => expect(screen.queryByTestId("period-dialog")).toBeNull());
    expect(posts).toEqual([
      {
        action: "period",
        days: 7,
        ads: [
          { adId: "a1", impressions: 1_400, clicks: 70, leads: 0, spendRub: 1_530 },
          { adId: "a2", impressions: 0, clicks: 0, leads: 0, spendRub: 0 },
        ],
      },
    ]);
    expect(screen.getByRole("button", { name: "Сервис разбирает…" })).toBeDisabled();
    expect(screen.getByTestId("studio-thinking")).toHaveTextContent("Сервис разбирает дни 11–17…");
  });

  it("fills the window approximately, with numbers it accepts, and sends nothing", async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(status()) }));
    vi.stubGlobal("fetch", fetch);
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    await open();
    fireEvent.click(screen.getByTestId("period-fill"));
    const number = (title: string, label: string) => Number(field(title, label).value.replace(/\D/g, ""));
    for (const title of ["Автоматизация ресторанов доставки", "Интеграция с агрегаторами"]) {
      expect(number(title, "Показы")).toBeGreaterThanOrEqual(number(title, "Переходы"));
      expect(number(title, "Переходы")).toBeGreaterThan(0);
      expect(number(title, "Переходы")).toBeGreaterThanOrEqual(number(title, "Обращения"));
      expect(number(title, "Расход, ₽")).toBeGreaterThan(0);
    }
    expect(number("Автоматизация ресторанов доставки", "Расход, ₽") + number("Интеграция с агрегаторами", "Расход, ₽")).toBeLessThanOrEqual(4_200);
    expect(fetch.mock.calls.filter((call) => (call as unknown[])[1] !== undefined)).toEqual([]);
  });

  it("says the advertising changed and shows the ads shown now when the server refuses the period", async () => {
    const now = status({ form: { ...form, directions: [{ ...form.directions[0]!, ads: [{ id: "a2", title: "Интеграция с агрегаторами" }] }] } });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/simulation" && init?.method === "POST") {
          return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ code: "SIMULATION_ADS_CHANGED", message: "Реклама изменилась, пока окно было открыто: проверьте объявления и лимиты" }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(now) });
      }),
    );
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    await open();
    fireEvent.click(screen.getByTestId("period-send"));
    expect(await screen.findByText("Реклама изменилась, пока окно было открыто: проверьте объявления и лимиты")).toBeTruthy();
    await waitFor(() => expect([...document.querySelectorAll("[data-testid=period-ad] .period-ad-title")].map((t) => t.textContent)).toEqual(["Интеграция с агрегаторами"]));
    expect(screen.getByTestId("period-dialog")).toBeTruthy();
  });

  it("says so when no ad is shown, and still lets the period go", async () => {
    render(<SummaryView model={model()} work={work({ sim })} simulation={status({ form: { from: "2026-11-11", directions: [] } })} />);
    await open();
    expect(screen.getByText("Сейчас ни одно объявление не показывается")).toBeTruthy();
    expect(screen.getByTestId("period-send")).not.toBeDisabled();
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

describe("a sent period (simulation-mode spec: a period that is not over is not shown as lived)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the period going until the worker takes it, instead of the day before as if nothing were sent", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let server: SimulationStatus = status();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const body = url === "/api/simulation" && init?.method === "POST" ? { jobId: "j1" } : url.startsWith("/api/jobs/") ? { state: "running" } : server;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      }),
    );
    render(<SummaryView model={model()} work={work({ sim })} simulation={status()} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить статистику" }));
    fireEvent.click(await screen.findByTestId("period-send"));
    // The worker has not taken the period yet: the server still says «paused» about day 11.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(screen.getByRole("button", { name: "Сервис разбирает…" })).toBeDisabled();
    expect(screen.queryByTestId("studio-review")).toBeNull();
    server = status({ status: "stepping", step: { from: 11, to: 17 }, agentTurn: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(screen.getByRole("button", { name: "Сервис разбирает…" })).toBeDisabled();
    server = status({ day: 18, periods: 2 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    // The period is over: the main button offers the next one again (the job's own wait may still hold it a moment).
    expect(screen.getByRole("button", { name: "Добавить статистику" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Сервис разбирает…" })).toBeNull();
    expect(screen.getByTestId("studio-day")).toHaveTextContent("День 18");
  });
});

describe("two sections in both modes (simulation-mode spec «Симуляция как отдельный режим»)", () => {
  it("has no «Симуляция» in the navigation", () => {
    render(<AppHeader launched demo={false} signOutAction={() => Promise.resolve()} />);
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Импульс", "Реклама", "Настройки"]);
  });
});

describe("leaving a demo (auth spec «Демо-вход»)", () => {
  it("asks first in a demo, stays on «Остаться» and leaves on «Выйти»", async () => {
    const signOut = vi.fn(() => Promise.resolve());
    render(<AppHeader launched demo signOutAction={signOut} />);
    const exit = within(screen.getByRole("banner")).getByRole("button", { name: /Выйти/ });
    expect(exit.closest("form")).toBeNull();
    fireEvent.click(exit);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Если выйти, вернуться в это демо не получится");
    fireEvent.click(within(dialog).getByRole("button", { name: "Остаться" }));
    expect(signOut).not.toHaveBeenCalled();
    fireEvent.click(exit);
    // The first window may still be fading out: the newest one is the last.
    const again = (await screen.findAllByRole("dialog")).at(-1);
    if (again === undefined) throw new Error("no dialog");
    fireEvent.click(within(again).getByRole("button", { name: "Выйти" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("leaves another account at once, without a question", () => {
    render(<AppHeader launched demo={false} signOutAction={() => Promise.resolve()} />);
    const button = screen.getByRole("button", { name: /Выйти/ });
    expect(button).toHaveAttribute("type", "submit");
    expect(button.closest("form")).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
