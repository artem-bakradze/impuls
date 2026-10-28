import { describe, expect, it } from "vitest";
import { describeDiff, filterHistory, historyType, objectName } from "./history-view";
import type { HistoryItem, Names } from "./history-view";

const plain = (text: string) => text.replace(/ /g, " ");
const names: Names = { directions: { d1: "Маникюр — Поиск" }, ads: { a1: "Маникюр у метро" }, strategies: { WB_MAXIMUM_CLICKS: "Максимум кликов" } };

const item = (id: string, author: HistoryItem["author"], at: string, type: HistoryItem["type"] = "settings"): HistoryItem => ({
  id,
  at,
  author,
  type,
  object: "Вся реклама",
  diff: [],
  explanation: id,
  outcome: null,
  status: "applied",
  reverted: false,
  rollback: { kind: "available", consequences: [] },
});

describe("history view", () => {
  it("shows «было → стало» only for changed fields, in plain words", () => {
    const rows = describeDiff({ status: "active", weeklyLimit: 150_000, schedule: "Пн–Вс 10:00–20:00" }, { status: "active", weeklyLimit: 150_000, schedule: "Пн–Вс 10:00–21:00" }, names);
    expect(rows).toEqual([{ label: "Время показа", before: "Пн–Вс 10:00–20:00", after: "Пн–Вс 10:00–21:00" }]);
    expect(describeDiff({ geoRadiusKm: 3 }, { geoRadiusKm: 5 }, names)).toEqual([{ label: "Зона показа", before: "3 км", after: "5 км" }]);
    expect(describeDiff({ status: "active" }, { status: "paused" }, names)[0]).toMatchObject({ before: "работает", after: "на паузе" });
    expect(plain(describeDiff({ weeklyLimit: 150_000 }, { weeklyLimit: 100_000 }, names)[0]?.after ?? "")).toBe("1 000 ₽ в неделю");
  });

  it("names business-wide snapshots by direction, not by id", () => {
    expect(describeDiff({ d1: "active" }, { d1: "paused" }, names)).toEqual([{ label: "Направление «Маникюр — Поиск»", before: "работает", after: "на паузе" }]);
    expect(objectName("ad", "a1", names)).toBe("Объявление «Маникюр у метро»");
  });

  it("groups changes into the spec's filter types", () => {
    expect(historyType("SetSpendLimit", "BUDGET_FIT", "direction")).toBe("budget");
    expect(historyType("ExternalChange", "USER_BUDGET", "business")).toBe("budget");
    expect(historyType("PauseAd", "SAFETY_PAUSE_AD", "ad")).toBe("ads");
    expect(historyType("StartExperiment", "SAFETY_START_EXPERIMENT", "direction")).toBe("experiments");
    expect(historyType("UpdateSchedule", "USER_CHANGE", "direction")).toBe("settings");
  });

  it("«Сделал сервис» shows only automatic changes, newest first", () => {
    const items = [item("old", "service", "2026-10-01T10:00:00Z"), item("mine", "user", "2026-10-02T10:00:00Z"), item("new", "service", "2026-10-03T10:00:00Z")];
    const visible = filterHistory(items, { author: "service", type: "all", days: null }, new Date("2026-10-04T00:00:00Z"));
    expect(visible.map((i) => i.id)).toEqual(["new", "old"]);
  });

  it("filters by period", () => {
    const items = [item("old", "service", "2026-09-01T10:00:00Z"), item("new", "service", "2026-10-03T10:00:00Z")];
    expect(filterHistory(items, { author: "all", type: "all", days: 7 }, new Date("2026-10-04T00:00:00Z")).map((i) => i.id)).toEqual(["new"]);
  });
});
