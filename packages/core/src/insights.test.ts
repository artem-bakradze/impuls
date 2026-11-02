import { describe, expect, it } from "vitest";
import { validateExplanation } from "./explanations";
import { validateInsight } from "./insights";
import type { InsightFact } from "./insights";

const catalog: InsightFact[] = [
  { key: "ad:a2:spend:14d", object: "объявление «Маникюр без записи»", metric: "spend", period: "14d", value: 1_530, unit: "rub" },
  { key: "ad:a2:leads:14d", object: "объявление «Маникюр без записи»", metric: "leads", period: "14d", value: 0, unit: "count" },
  { key: "goal:cost_per_lead", object: "цель", metric: "goal", period: "now", value: 500, unit: "rub" },
];

const draft = {
  reasonCode: "PAUSE_INEFFECTIVE",
  observation: "Объявление «Маникюр без записи» потратило 1 530 ₽ и не привело клиентов.",
  factKeys: ["ad:a2:spend:14d", "ad:a2:leads:14d", "goal:cost_per_lead"],
  next: "Через 7 дней сравним цену обращения рекламы в поиске.",
};

describe("insight check (insights spec «Факты проверяются по данным»)", () => {
  it("accepts facts from the catalog and numbers that are in the data", () => {
    expect(validateInsight(draft, catalog)).toEqual([]);
  });

  it("refuses a number that is not in the data", () => {
    expect(validateInsight({ ...draft, observation: "Объявление потратило 3 000 ₽ и не привело клиентов." }, catalog)).toEqual([
      { code: "UNKNOWN_NUMBER", message: "число 3 000 ₽ не найдено в данных" },
    ]);
  });

  it("refuses a fact the service does not have", () => {
    expect(validateInsight({ ...draft, factKeys: ["ad:a2:spend:14d", "ad:a2:leads:evening"] }, catalog)).toEqual([
      { code: "UNKNOWN_FACT", message: "таких данных у сервиса нет: ad:a2:leads:evening" },
    ]);
  });

  it("needs 2 to 4 facts and both texts, in plain words", () => {
    expect(validateInsight({ ...draft, factKeys: ["ad:a2:spend:14d"] }, catalog).map((i) => i.code)).toEqual(["FACT_COUNT"]);
    expect(validateInsight({ ...draft, factKeys: [] }, catalog).map((i) => i.code)).toEqual(["FACT_COUNT"]);
    expect(validateInsight({ ...draft, next: " " }, catalog).map((i) => i.code)).toEqual(["EMPTY_TEXT"]);
    expect(validateInsight({ ...draft, decision: "Пока ничего не меняем: низкий CTR" }, catalog).map((i) => i.code)).toEqual(["JARGON"]);
  });
});

describe("dates and terms in the texts", () => {
  it("are not numbers from the data: «к 22 ноября», «через 7 дней» pass, an unknown amount does not", () => {
    expect(validateExplanation("Проверим цену обращения к 22 ноября и ещё раз через 7 дней.", [])).toEqual([]);
    expect(validateExplanation("За последние 7 и 14 дней обращений не было; реклама идёт до 22:00, по будням 10:00–20:00.", [])).toEqual([]);
    expect(validateExplanation("Объявление потратило 22 ₽.", [])).toEqual([{ code: "UNKNOWN_NUMBER", message: "число 22 ₽ не найдено в данных" }]);
    expect(validateExplanation("Обращений стало 22.", [])).toEqual([{ code: "UNKNOWN_NUMBER", message: "число 22 не найдено в данных" }]);
  });
});

describe("a garbled fact key", () => {
  it("is refused with the key it most likely meant, so the agent can fix it at once", () => {
    const id = "dir-d4989292-ad25-4a93-9b36-cc6b6a565792";
    const catalog: InsightFact[] = [
      { key: `direction:${id}:spend:14d`, object: "реклама на сайтах-партнёрах", metric: "spend", period: "14d", value: 10, unit: "rub" },
      { key: "goal:goal:now", object: "цель", metric: "goal", period: "now", value: 800, unit: "rub" },
    ];
    const draft = { reasonCode: "WAIT", observation: "Данных пока мало.", factKeys: ["direction:d-d4989292-ad25-4a93-9b36-cc6b6a565792:spend:14d", "goal:goal:now"], next: "Через неделю." };
    expect(validateInsight(draft, catalog).map((i) => i.message)).toEqual([
      `таких данных у сервиса нет: direction:d-d4989292-ad25-4a93-9b36-cc6b6a565792:spend:14d — возможно, нужен ключ direction:${id}:spend:14d`,
    ]);
    // A key unlike any in the catalog gets no guess.
    expect(validateInsight({ ...draft, factKeys: ["ad:x:leads:evening", "goal:goal:now"] }, catalog).map((i) => i.message)).toEqual(["таких данных у сервиса нет: ad:x:leads:evening"]);
  });
});
