import { describe, expect, it } from "vitest";
import type { TurnStep } from "@impuls/worker/turn-steps";
import { REVIEW_STEPS_SHOWN, reviewStepLines } from "./review-steps";

const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("the review's steps in the owner's words (simulation-mode «Ход разбора на глазах владельца»)", () => {
  it("says each kind of step plainly, with the period's days and the history's words of a change", () => {
    const steps: TurnStep[] = [
      { kind: "numbers" },
      { kind: "memory" },
      { kind: "breakdown", dimension: "device" },
      { kind: "breakdown", dimension: "query" },
      { kind: "hypothesis_saved", statement: "С телефонов обращения дороже, чем с компьютеров." },
      { kind: "hypothesis_closed", statement: "Реклама в поиске приводит клиентов дешевле цели", status: "confirmed" },
    ];
    expect(reviewStepLines(steps, "дни 9–15", new Map())).toEqual([
      "Смотрю цифры за дни 9–15",
      "Вспоминаю, что уже заметил и что проверяю",
      "Сравниваю телефоны и компьютеры",
      "Смотрю, по каким запросам показывалась реклама в поиске",
      "Предполагаю: с телефонов обращения дороже, чем с компьютеров",
      "Проверил: реклама в поиске приводит клиентов дешевле цели — подтвердилось",
    ]);
    expect(reviewStepLines([{ kind: "numbers" }], "день 9", new Map())).toEqual(["Смотрю цифры за день 9"]);
  });

  it("names a change in the history's words and leaves out one it has no words for", () => {
    const steps: TurnStep[] = [
      { kind: "change", changeId: "chg-1" },
      { kind: "change", changeId: "chg-unknown" },
      { kind: "observation", text: "Реклама на сайтах-партнёрах приводит обращения дешевле, чем в поиске." },
      { kind: "hypothesis_closed", statement: "Поиску мало дней", status: "rejected" },
      { kind: "hypothesis_closed", statement: "Цена перехода высока", status: "dropped" },
    ];
    expect(reviewStepLines(steps, "день 9", new Map([["chg-1", "Убрал показы по запросам «фото»"]])).map(plain)).toEqual([
      "Убрал показы по запросам «фото»",
      "Заметил: реклама на сайтах-партнёрах приводит обращения дешевле, чем в поиске",
      "Проверил: поиску мало дней — не подтвердилось",
      "Проверил: цена перехода высока — снял с проверки",
    ]);
  });

  it("keeps the last six steps, says a repeated line once, and keeps capitals of a name", () => {
    const steps: TurnStep[] = [
      { kind: "numbers" },
      ...Array.from({ length: 6 }, (_, i): TurnStep => ({ kind: "observation", text: `Заметка номер ${i + 1}.` })),
      { kind: "observation", text: "Заметка номер 6." },
      { kind: "hypothesis_saved", statement: "WhatsApp приводит больше обращений" },
    ];
    const lines = reviewStepLines(steps, "день 9", new Map());
    expect(lines).toHaveLength(REVIEW_STEPS_SHOWN);
    expect(lines[0]).toBe("Заметил: заметка номер 2");
    expect(lines.filter((l) => l === "Заметил: заметка номер 6")).toHaveLength(1);
    expect(lines.at(-1)).toBe("Предполагаю: WhatsApp приводит больше обращений");
  });

  it("replaces the agent's words of the stop-list as the journal does", () => {
    expect(reviewStepLines([{ kind: "observation", text: "Сохранил инсайт о телефонах." }], null, new Map())).toEqual(["Заметил: сохранил наблюдение о телефонах"]);
  });
});
