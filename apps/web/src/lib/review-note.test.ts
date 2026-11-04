import { describe, expect, it } from "vitest";
import { noteExpect, noteSeen, noteSentence, noteTitle } from "./review-note";

describe("the studio's review as a note (simulation-mode spec «Симуляция как отдельный режим»)", () => {
  it("names the review and its day", () => {
    expect(noteTitle({ weekly: true, date: "2026-11-09", from: null })).toBe("Разбор недели · 9 ноября");
    expect(noteTitle({ weekly: false, date: "2026-11-11", from: null })).toBe("Разбор дня · 11 ноября");
    expect(noteTitle({ weekly: false, date: "2026-11-07", from: "2026-11-03" })).toBe("Разбор дня · 3–7 ноября");
  });

  it("reads the reasoning as one text with what the closed checks found", () => {
    expect(
      noteSeen({
        headline: "Посмотрели рекламу — менять ничего не нужно.",
        paragraphs: ["Обращения с компьютеров по-прежнему дешевле цели."],
        found: [{ statement: "С телефонов обращения дороже", outcome: "подтвердилось", result: "С телефонов — 1 240 ₽, с компьютеров — 414 ₽." }],
      }),
    ).toEqual([
      "Посмотрели рекламу — менять ничего не нужно. Обращения с компьютеров по-прежнему дешевле цели.",
      "Выяснил: С телефонов обращения дороже — подтвердилось. С телефонов — 1 240 ₽, с компьютеров — 414 ₽.",
    ]);
    expect(noteSeen({ headline: null, paragraphs: ["С компьютеров получено 3 обращения по 414 ₽ при цели 1 000 ₽."], found: [] })).toEqual([
      "С компьютеров получено 3 обращения по 414 ₽ при цели 1 000 ₽.",
    ]);
  });

  it("says a change as a sentence", () => {
    expect(noteSentence("Поднял цену перехода с компьютеров на 10%.")).toBe("Поднял цену перехода с компьютеров на 10%");
  });

  it("joins the open checks of one day and drops a «Что дальше» that only names a check", () => {
    expect(
      noteExpect({
        expects: ["К 16 ноября проверю стоимость и число обращений с компьютеров.", "Жду больше обращений с компьютеров по цене не выше цели — проверю к 16 ноября."],
        checking: [
          { statement: "Проверяю, продолжит ли запрос «автоматизация ресторанов» приносить обращения дешевле цели.", checkOn: "2026-11-16" },
          { statement: "Проверяю, останется ли стоимость обращений с компьютеров ниже цели.", checkOn: "2026-11-16" },
          { statement: "С телефонов обращения дороже, чем с компьютеров", checkOn: "2026-11-23" },
        ],
      }),
    ).toEqual([
      "Жду больше обращений с компьютеров по цене не выше цели — проверю к 16 ноября.",
      "16 ноября проверю, продолжит ли запрос «автоматизация ресторанов» приносить обращения дешевле цели и останется ли стоимость обращений с компьютеров ниже цели.",
      "23 ноября проверю, верно ли, что с телефонов обращения дороже, чем с компьютеров.",
    ]);
  });

  it("keeps what the service wrote when it opened no checks", () => {
    expect(noteExpect({ expects: ["К 15 ноября проверю расход и стоимость обращения."], checking: [] })).toEqual(["К 15 ноября проверю расход и стоимость обращения."]);
    expect(noteExpect({ expects: [], checking: [] })).toEqual([]);
  });
});
