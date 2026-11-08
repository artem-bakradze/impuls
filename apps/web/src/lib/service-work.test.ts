import { rubles } from "@impuls/core";
import type { ChangeEntry } from "@impuls/worker";
import { describe, expect, it } from "vitest";
import { groupRub } from "./format";
import type { HistoryItem } from "./history-view";
import type { DayReviewModel, InsightCardModel } from "./insights-model";
import { briefChange, buildServiceWork, changeHeadline, plain } from "./service-work";

const item = (overrides: Partial<HistoryItem>): HistoryItem => ({
  id: "c1",
  at: "2026-11-05T09:00:00Z",
  author: "user",
  object: "Реклама в поиске",
  diff: [{ label: "Время показа", before: "Пн–Вс 10:00–20:00", after: "Пн–Вс 10:00–21:00" }],
  explanation: "Вы изменили время показа.",
  outcome: null,
  turnId: null,
  insight: null,
  status: "applied",
  reverted: false,
  rollback: { kind: "available", consequences: [] },
  budgetAdjustment: false,
  ...overrides,
});

const review: DayReviewModel = {
  date: "2026-11-04",
  from: null,
  summary: "**Разбор дня:** пока ничего не меняю: реклама собирает данные.",
  quiet: false,
  rulesReason: null,
  insights: [],
  weekly: null,
};

const build = (history: HistoryItem[], reviews: DayReviewModel[] = [review], changes: ChangeEntry[] = []) =>
  buildServiceWork({
    ads: [],
    directions: [],
    stats: [],
    today: "2026-11-10",
    startedOn: "2026-11-01",
    timeZone: "Europe/Moscow",
    cso: rubles(500),
    reviews,
    history,
    changes,
    openChecks: [],
    weeks: [{ week: 1, from: "2026-11-01", reviewedOn: "2026-11-08" }, { week: 2, from: "2026-11-08", reviewedOn: "2026-11-15" }],
  });

describe("the journal is the history (insights spec «Лента инсайтов и связь с историей»)", () => {
  it("tells the owner's change in one line with its rollback, after the day's review", () => {
    const work = build([item({})]);
    const entries = work.journal.flatMap((s) => s.entries);
    expect(entries.map((e) => e.kind)).toEqual(["agent", "owner"]);
    const change = entries[1]?.changes[0];
    expect(change?.text).toBe("Вы: Реклама в поиске — время показа: было Пн–Вс 10:00–20:00 → стало Пн–Вс 10:00–21:00");
    expect(change?.item?.rollback.kind).toBe("available");
    expect(entries[0]?.headline).toBe("Пока ничего не меняю: реклама собирает данные.");
  });

  it("leaves the budget guard's limit cuts out: the budget line covers them", () => {
    const work = build([item({ id: "b1", author: "service", budgetAdjustment: true, explanation: "Лимит подстроен под остаток бюджета." })]);
    expect(work.journal.flatMap((s) => s.entries).some((e) => e.changes.some((c) => c.historyId === "b1"))).toBe(false);
  });

  it("names the launch and the Direct cabinet's changes in the owner's words", () => {
    const work = build([
      item({ id: "l1", at: "2026-11-01T06:00:00Z", reasonCode: "LAUNCH", diff: [{ label: "Реклама", before: "не запущена", after: "запущена" }] }),
      item({ id: "k1", author: "cabinet", at: "2026-11-09T06:00:00Z" }),
    ], []);
    const texts = work.journal.flatMap((s) => s.entries).flatMap((e) => e.changes.map((c) => c.text));
    expect(texts[0]).toBe("Вы: реклама запущена");
    expect(texts[1]?.startsWith("В кабинете Директа: Реклама в поиске")).toBe(true);
    expect(work.journal.map((s) => s.week)).toEqual([1, 2]);
  });

  it("names the ad the owner switched off", () => {
    const work = build([item({ object: "Объявление «Маникюр у метро»", decisionText: "Отключили объявление", diff: [] })], []);
    expect(work.journal[0]?.entries[0]?.changes[0]?.text).toBe("Вы: отключили объявление «Маникюр у метро»");
  });

  it("has no scenario truth without a simulation", () => {
    const work = build([]);
    expect(work.journal.flatMap((s) => s.entries).every((e) => e.truths.length === 0)).toBe(true);
  });
});

const change = (overrides: Partial<ChangeEntry>): ChangeEntry => ({
  id: "d1",
  businessId: "b1",
  actor: "agent",
  author: "service",
  action: { type: "SetDeviceAdjustment", directionId: "dir1", device: "desktop", percent: 10 },
  objectKind: "direction",
  objectId: "dir1",
  before: {},
  after: {},
  status: "applied",
  reasonCode: "AGENT",
  explanation: "Поднял цену перехода. Подробности в истории.",
  turnId: null,
  insightId: null,
  createdAt: new Date("2026-11-08T07:00:00Z"),
  error: null,
  revertedById: null,
  outcome: null,
  ...overrides,
});

const card = (overrides: Partial<InsightCardModel>): InsightCardModel => ({
  id: "i1",
  author: "agent",
  at: "2026-11-08T07:00:00Z",
  observation: "с компьютеров получено 3 обращения по 414 ₽ при цели 1000 ₽",
  facts: [],
  decision: { text: "Поднял цену перехода с компьютеров на 10%", status: "applied" },
  next: "",
  rollback: null,
  truth: null,
  objectIds: [],
  ...overrides,
});

describe("money in the service's own words (analytics spec «Сводка»)", () => {
  it("groups the digits of rubles in free text and leaves other numbers alone", () => {
    expect(groupRub("при цели 1000 ₽, в поиске — 1334₽")).toBe("при цели 1\u00a0000\u00a0₽, в поиске — 1\u00a0334\u00a0₽");
    expect(groupRub("в 2026 году 403 показа за 12 345 ₽")).toBe("в 2026 году 403 показа за 12 345 ₽");
  });

  it("groups the rubles of the agent's review in the journal", () => {
    const work = build([], [{ ...review, summary: "Стоимость обращения 1334 ₽ при цели 1000 ₽." }]);
    expect(work.journal[0]?.entries[0]?.headline).toBe("Стоимость обращения 1\u00a0334\u00a0₽ при цели 1\u00a0000\u00a0₽.");
  });
});

describe("what the service expects of a review (insights spec «Инсайт», «Что дальше»)", () => {
  it("keeps each insight's «Что дальше» once, as a sentence, for the studio's «Чего жду»", () => {
    const next = "Жду больше обращений с компьютеров по цене не выше цели — проверю к 16 ноября";
    const reviews: DayReviewModel[] = [{ ...review, date: "2026-11-08", summary: null, insights: [card({ next }), card({ id: "i2", next }), card({ id: "i3", next: " " })] }];
    expect(build([], reviews).journal[0]?.entries[0]?.expects).toEqual([`${next}.`]);
  });
});

describe("the latest changes on the main screen (change-history spec «Последнее изменение на главном экране»)", () => {
  it("names the price of a visit in the history's words, never «клик»", () => {
    expect(briefChange(change({}))).toBe("Цена перехода +10%");
    expect(briefChange(change({ action: { type: "SetDeviceAdjustment", directionId: "dir1", device: "mobile", percent: -30 } }))).toBe("Цена перехода −30%");
  });

  it("keeps up to three decisions not reverted, newest first, each with its reason", () => {
    const reviews: DayReviewModel[] = [{ ...review, date: "2026-11-08", summary: null, insights: [card({})] }];
    const work = build([], reviews, [
      change({ id: "d1", insightId: "i1", createdAt: new Date("2026-11-08T07:00:00Z") }),
      change({ id: "d2", createdAt: new Date("2026-11-07T07:00:00Z"), action: { type: "PauseAd", adId: "a1" }, objectKind: "ad", objectId: "a1", explanation: "Отключил объявление: за 10 дней 2400 ₽ без обращений. Деньги пойдут другим." }),
      change({ id: "d3", createdAt: new Date("2026-11-06T07:00:00Z"), revertedById: "r1" }),
      change({ id: "d4", createdAt: new Date("2026-11-05T07:00:00Z") }),
      change({ id: "d5", createdAt: new Date("2026-11-04T07:00:00Z") }),
      change({ id: "g1", createdAt: new Date("2026-11-09T07:00:00Z"), actor: "budget_guard", reasonCode: "BUDGET_FIT", action: { type: "SetSpendLimit", directionId: "dir1", weeklyLimit: rubles(1_000) } }),
    ]);
    expect(work.recentChanges.map((c) => c.historyId)).toEqual(["d1", "d2", "d4"]);
    expect(work.recentChanges[0]?.reason).toBe("С компьютеров получено 3 обращения по 414 ₽ при цели 1\u00a0000\u00a0₽.");
    expect(work.recentChanges[1]?.reason).toBe("Отключил объявление: за 10 дней 2\u00a0400\u00a0₽ без обращений.");
    expect(work.lastChange?.historyId).toBe("d1");
    expect(work.changesLast7).toBe(5);
  });

  it("names the last change in the history's words and gives one sentence of why, not the action again", () => {
    const observation = "С начала рекламы по запросу «доставка еды фото» потрачено 501 ₽ и не было обращений. Добавляю «фото» в минус-фразы, чтобы реклама не показывалась по таким запросам.";
    const reviews: DayReviewModel[] = [{ ...review, date: "2026-11-08", summary: null, insights: [card({ observation })] }];
    const work = build([], reviews, [change({ id: "n1", insightId: "i1", action: { type: "AddNegativeKeywords", directionId: "dir1", phrases: ["фото"] } })]);
    expect(work.lastChange?.text).toBe("Убрал показы по запросам со словом «фото»");
    expect(work.lastChange?.reason).toBe("С начала рекламы по запросу «доставка еды фото» потрачено 501 ₽ и не было обращений.");
  });
});

describe("the queries a negative phrase cuts off, in the owner's words", () => {
  const negative = (phrases: string[], type: "AddNegativeKeywords" | "RemoveNegativeKeywords" = "AddNegativeKeywords") =>
    changeHeadline(change({ action: { type, directionId: "dir1", phrases } }), new Map(), new Map());

  it("names the words of the queries, not a quote that reads as a whole query", () => {
    expect(negative(["фото"])).toBe("Убрал показы по запросам со словом «фото»");
    expect(negative(["своими руками"])).toBe("Убрал показы по запросам со словами «своими руками»");
    expect(negative(["фото", "бесплатно"])).toBe("Убрал показы по запросам со словами «фото» или «бесплатно»");
    expect(negative(["фото", "бесплатно", "вакансии"])).toBe("Убрал показы по запросам со словами «фото», «бесплатно» и ещё 1");
    expect(negative(["фото"], "RemoveNegativeKeywords")).toBe("Вернул показы по запросам со словом «фото»");
  });
});

describe("Direct's words in the agent's text (change-history stop-list)", () => {
  it("says «исключения» for negative phrases in the same case, and «разбивка» for a breakdown", () => {
    expect(plain("Добавляю «фото» в минус-фразы, чтобы реклама не показывалась по таким запросам.")).toBe("Добавляю «фото» в исключения, чтобы реклама не показывалась по таким запросам.");
    expect(plain("Добавил минус-фразу «фото». Минус-фраза уже работает, других минус-фраз нет.")).toBe("Добавил фразу-исключение «фото». Фраза-исключение уже работает, других фраз-исключений нет.");
    expect(plain("Посмотрел разрезы по запросам; по разрезу телефонов данных мало.")).toBe("Посмотрел разбивки по запросам; по разбивке телефонов данных мало.");
  });

  it("leaves words that only start the same alone", () => {
    expect(plain("минус-фразовый словарь, разрезание")).toBe("минус-фразовый словарь, разрезание");
  });
});

describe("the next check on the main screen (analytics spec «Сводка»)", () => {
  it("takes the nearest open check and counts the others", () => {
    const work = buildServiceWork({
      ads: [], directions: [], stats: [], today: "2026-11-10", startedOn: "2026-11-01", timeZone: "Europe/Moscow", cso: rubles(500), reviews: [], history: [], changes: [], weeks: [],
      openChecks: [
        { statement: "Проверяю, приведёт ли запрос «маникюр» обращения дешевле 1000 ₽", checkOn: "2026-11-20" },
        { statement: "Проверяю, останется ли цена с компьютеров ниже цели", checkOn: "2026-11-16" },
      ],
    });
    expect(work.nextCheck).toEqual({ statement: "Проверяю, останется ли цена с компьютеров ниже цели", checkOn: "2026-11-16", more: 1 });
    expect(work.cso).toBe(rubles(500));
  });

  it("has no next check when nothing is being checked", () => {
    expect(build([]).nextCheck).toBeNull();
  });
});
