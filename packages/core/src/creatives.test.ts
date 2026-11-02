import { describe, expect, it } from "vitest";
import { mentionsFact, validateAdText } from "./creatives";

const facts = ["1 800 ₽", "Профсоюзная", "до 22:00"];

describe("validateAdText", () => {
  it("accepts a concrete ad within limits", () => {
    expect(validateAdText({ title: "Маникюр у м. Профсоюзная", text: "Маникюр с покрытием за 1 800 ₽. Работаем до 22:00" }, facts)).toEqual([]);
  });

  it("rejects «Лучший маникюр в районе»", () => {
    expect(validateAdText({ title: "Лучший маникюр в районе", text: "Маникюр за 1 800 ₽" }, facts).map((i) => i.code)).toEqual(["SUPERLATIVE"]);
  });

  it("rejects medical promises, guarantees and caps", () => {
    expect(validateAdText({ title: "Йога вылечит спину", text: "ГАРАНТИРУЕМ результат у м. Профсоюзная" }, facts).map((i) => i.code)).toEqual(
      expect.arrayContaining(["MEDICAL_PROMISE", "CAPS"]),
    );
    expect(validateAdText({ title: "Похудение у м. Профсоюзная", text: "Гарантируем результат" }, facts).map((i) => i.code)).toContain("GUARANTEE");
  });

  it("enforces Direct length limits", () => {
    expect(validateAdText({ title: "М".repeat(57), text: "Профсоюзная" }, facts).map((i) => i.code)).toContain("TOO_LONG");
    expect(validateAdText({ title: "Маникюр", title2: "х".repeat(31), text: "Профсоюзная" }, facts).map((i) => i.code)).toContain("TOO_LONG");
  });

  it("requires at least one fact from the business card", () => {
    expect(validateAdText({ title: "Маникюр", text: "Приходите к нам" }, facts).map((i) => i.code)).toEqual(["NO_FACT"]);
  });

  it("counts a fact in other word forms, but not a single shared word of a long phrase", () => {
    const b2b = ["подключение и настройка платформы автоматизации ресторанной доставки", "Онлайн-настройка по всей России"];
    expect(validateAdText({ title: "Автоматизация ресторанной доставки", text: "Подключим и настроим платформу" }, b2b)).toEqual([]);
    expect(validateAdText({ title: "Настроим доставку ресторана", text: "Работаем онлайн по всей России" }, b2b)).toEqual([]);
    expect(validateAdText({ title: "Платформа для вашего бизнеса", text: "Оставьте заявку" }, b2b).map((i) => i.code)).toEqual(["NO_FACT"]);
    expect(mentionsFact("Маникюр у метро", "до 22:00")).toBe(false);
  });
});
