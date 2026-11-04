import { describe, expect, it } from "vitest";
import { calendarWords, simulationWords } from "./day-words";

const sim = simulationWords("2026-11-01");

describe("days instead of dates in a simulation (simulation-mode spec «Дни симуляции вместо дат»)", () => {
  it("names a day by its number from the launch", () => {
    expect(sim.date("2026-11-01")).toBe("день 1");
    expect(sim.date("2026-11-09")).toBe("день 9");
    expect(sim.range("2026-11-01", "2026-11-09")).toBe("дни 1–9");
    expect(sim.range("2026-11-09", "2026-11-09")).toBe("день 9");
    expect(sim.on("2026-11-16")).toBe("в день 16");
    expect(sim.by("2026-11-09")).toBe("ко дню 9");
    expect(sim.until("2026-11-27")).toBe("до дня 27");
    // Across the month's end the days go on.
    expect(sim.date("2026-12-02")).toBe("день 32");
  });

  it("turns the dates of the agent's words into days, declined by their preposition", () => {
    expect(sim.text("Сохранил наблюдение и проверю результаты к 15 ноября.")).toBe("Сохранил наблюдение и проверю результаты ко дню 15.");
    expect(sim.text("16 ноября проверю стоимость.")).toBe("В день 16 проверю стоимость.");
    expect(sim.text("Повторно проверю стоимость до 9 ноября, а с 3 ноября смотрю дальше.")).toBe("Повторно проверю стоимость до дня 9, а с дня 3 смотрю дальше.");
    expect(sim.text("За 1–9 ноября пришло 12 обращений.")).toBe("За дни 1–9 пришло 12 обращений.");
    expect(sim.text("Обращения 7 ноября были дороже. 8 ноября — дешевле.")).toBe("Обращения в день 7 были дороже. В день 8 — дешевле.");
    expect(sim.text("Итог на 16 ноября 2026 г. будет готов")).toBe("Итог на день 16 будет готов");
  });

  it("leaves what is not a day of the simulation as it is", () => {
    expect(sim.text("Проверю через 7 дней, к 22-му числу.")).toBe("Проверю через 7 дней, к 22-му числу.");
    expect(sim.text("С 25 октября реклама шла иначе.")).toBe("С 25 октября реклама шла иначе.");
    expect(sim.text("Цена 10 пунктов")).toBe("Цена 10 пунктов");
  });

  it("keeps the calendar in Direct", () => {
    expect(calendarWords.date("2026-11-09")).toBe("9 ноября");
    expect(calendarWords.range("2026-11-01", "2026-11-09")).toBe("1–9 ноября");
    expect(calendarWords.on("2026-11-16")).toBe("16 ноября");
    expect(calendarWords.by("2026-11-09")).toBe("к 9 ноября");
    expect(calendarWords.text("проверю к 15 ноября")).toBe("проверю к 15 ноября");
  });
});
