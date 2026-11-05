import { describe, expect, it } from "vitest";
import { checkPeriod, lastEntered, PERIOD_DAYS, suggestPeriod } from "./simulation-period";
import type { PeriodForm } from "./simulation-period";

const form = (last: Partial<Record<string, PeriodForm["directions"][number]["ads"][number]["last"]>> = {}): PeriodForm => ({
  from: "2026-11-09",
  directions: [
    {
      id: "d1",
      name: "Маникюр — Поиск",
      channel: "search",
      ads: ["a1", "a2", "a3"].map((id) => ({ id, title: `Объявление ${id}`, ...(last[id] !== undefined && { last: last[id] }) })),
      roomRub: { 1: 460, 3: 1_380, 7: 1_620, 14: 3_240 },
    },
    { id: "d2", name: "Маникюр — Сайты-партнёры", channel: "network", ads: [{ id: "n1", title: "Ноготок" }], roomRub: { 1: 300, 3: 900, 7: 1_080, 14: 2_160 } },
  ],
});

describe("«Заполнить примерно» (simulation-mode spec «Статистика периода от владельца»)", () => {
  it("fills every ad with numbers the window accepts, the same for the same window", () => {
    for (const days of PERIOD_DAYS) {
      const rows = suggestPeriod(form(), days);
      expect(rows.map((r) => r.adId)).toEqual(["a1", "a2", "a3", "n1"]);
      expect(checkPeriod(form(), days, rows)).toEqual({ errors: [], changed: false });
      expect(suggestPeriod(form(), days)).toEqual(rows);
      expect(rows.every((r) => r.clicks > 0 && r.impressions >= r.clicks && r.leads <= r.clicks)).toBe(true);
      // About 70% of what Direct would spend, never more than it.
      const search = rows.filter((r) => r.adId.startsWith("a")).reduce((s, r) => s + r.spendRub, 0);
      expect(search).toBeLessThanOrEqual(Math.floor(form().directions[0]!.roomRub[days] * 0.7));
      expect(search).toBeGreaterThan(form().directions[0]!.roomRub[days] * 0.6);
    }
  });

  it("gives different ads different numbers, and a partner site's ad fewer clicks per showing", () => {
    const rows = suggestPeriod(form(), 7);
    expect(new Set(rows.map((r) => r.leads / r.clicks)).size).toBe(rows.length);
    const ctr = (id: string) => {
      const row = rows.find((r) => r.adId === id);
      return (row?.clicks ?? 0) / (row?.impressions ?? 1);
    };
    expect(ctr("n1")).toBeLessThan(ctr("a1"));
  });

  it("continues an ad's last period: its price per lead stays close, an ad without leads gets none", () => {
    const rows = suggestPeriod(
      form({
        a1: { days: 7, impressions: 1_000, clicks: 50, leads: 5, spendRub: 1_000 },
        a2: { days: 7, impressions: 1_000, clicks: 25, leads: 0, spendRub: 500 },
      }),
      7,
    );
    const a1 = rows.find((r) => r.adId === "a1");
    const a2 = rows.find((r) => r.adId === "a2");
    const costPerLead = (a1?.spendRub ?? 0) / (a1?.leads ?? 1);
    expect(costPerLead).toBeGreaterThan(200 * 0.7);
    expect(costPerLead).toBeLessThan(200 * 1.4);
    expect(a2?.leads).toBe(0);
    expect(a2?.clicks).toBeGreaterThan(0);
    // The ad that spent more a day gets the larger share.
    expect(a1?.spendRub ?? 0).toBeGreaterThan(a2?.spendRub ?? 0);
  });

  it("takes each ad's last non-zero numbers from the completed periods", () => {
    const steps = [
      { kind: "period", state: "completed", days: 7, input: [{ adId: "a1", impressions: 100, clicks: 10, leads: 1, spendRub: 300 }] },
      { kind: "period", state: "completed", days: 3, input: [{ adId: "a1", impressions: 0, clicks: 0, leads: 0, spendRub: 0 }, { adId: "a2", impressions: 50, clicks: 5, leads: 0, spendRub: 100 }] },
      { kind: "period", state: "failed", days: 1, input: [{ adId: "a2", impressions: 9, clicks: 1, leads: 1, spendRub: 30 }] },
    ];
    expect([...lastEntered(steps)]).toEqual([
      ["a1", { days: 7, impressions: 100, clicks: 10, leads: 1, spendRub: 300 }],
      ["a2", { days: 3, impressions: 50, clicks: 5, leads: 0, spendRub: 100 }],
    ]);
  });
});
