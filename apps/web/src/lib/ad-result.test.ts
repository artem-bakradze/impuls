import { describe, expect, it } from "vitest";
import { adResult } from "./ad-result";

describe("an ad's result in the studio (simulation-mode spec «Подписи студии»)", () => {
  it("says how much cheaper than the goal or the reference an ad brings a lead", () => {
    expect(adResult({ leads: 5, costPerLead: 13_800 }, 100_000, "ориентира")).toEqual({ tone: "good", text: "на 86% дешевле ориентира" });
    expect(adResult({ leads: 1, costPerLead: 45_400 }, 100_000, "цели")).toEqual({ tone: "good", text: "на 54% дешевле цели" });
  });

  it("calls a cost within 5% of the goal «в цели»", () => {
    expect(adResult({ leads: 3, costPerLead: 96_000 }, 100_000, "цели")).toEqual({ tone: "good", text: "в цели" });
    expect(adResult({ leads: 3, costPerLead: 100_000 }, 100_000, "ориентира")).toEqual({ tone: "good", text: "в пределах ориентира" });
  });

  it("says how much dearer than the goal an ad is", () => {
    expect(adResult({ leads: 2, costPerLead: 120_000 }, 100_000, "цели")).toEqual({ tone: "bad", text: "на 20% дороже цели" });
    expect(adResult({ leads: 1, costPerLead: 100_050 }, 100_000, "ориентира")).toEqual({ tone: "bad", text: "на 1% дороже ориентира" });
  });

  it("has no percent without leads or without a goal", () => {
    expect(adResult({ leads: 0, costPerLead: null }, 100_000, "цели")).toEqual({ tone: "neutral", text: "пока без обращений" });
    expect(adResult({ leads: 2, costPerLead: 26_600 }, 0, "цели").text.replace(/ /g, " ")).toBe("266 ₽ за обращение");
  });
});
