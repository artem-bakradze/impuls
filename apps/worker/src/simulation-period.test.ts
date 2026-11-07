import { describe, expect, it } from "vitest";
import { segmentVerdict } from "@impuls/core";
import { checkPeriod, DEFAULT_PERIOD_DAYS, junkQueryOf, lastEntered, MARKET, NO_MARKET, PERIOD_DAYS, periodForm, splitPeriod, suggestPeriod } from "./simulation-period";
import type { CampaignTrafficView, DirectionTraffic, PeriodForm, PeriodMarket } from "./simulation-period";

const even = { negativeKeywords: [], deviceAdjustments: { mobile: 0, desktop: 0 } };
const form = (last: Partial<Record<string, PeriodForm["directions"][number]["ads"][number]["last"]>> = {}): PeriodForm => ({
  from: "2026-11-09",
  directions: [
    {
      id: "d1",
      name: "Маникюр — Поиск",
      channel: "search",
      ads: ["a1", "a2", "a3"].map((id) => ({ id, title: `Объявление ${id}`, ...(last[id] !== undefined && { last: last[id] }) })),
      roomRub: { 1: 460, 3: 1_380, 7: 1_620, 14: 3_240 },
      keywords: ["маникюр"],
      ...even,
      junkQuery: "маникюр фото",
    },
    {
      id: "d2",
      name: "Маникюр — Сайты-партнёры",
      channel: "network",
      ads: [{ id: "n1", title: "Ноготок" }],
      roomRub: { 1: 300, 3: 900, 7: 1_080, 14: 2_160 },
      keywords: [],
      ...even,
      junkQuery: null,
    },
  ],
  market: MARKET,
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
        // Periods entered on the training market: nothing changed since, so the numbers carry on.
        a1: { days: 7, impressions: 1_000, clicks: 50, leads: 5, spendRub: 1_000, market: MARKET },
        a2: { days: 7, impressions: 1_000, clicks: 25, leads: 0, spendRub: 500, market: MARKET },
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

  it("opens on one day (market-leaks-live-review)", () => {
    expect(DEFAULT_PERIOD_DAYS).toBe(1);
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

describe("Breakdown of the owner's numbers (simulation-breakdowns)", () => {
  const search: DirectionTraffic = { keywords: ["маникюр"], negativeKeywords: [], deviceAdjustments: { mobile: 0, desktop: 0 }, junkQuery: "маникюр фото" };
  const junk: PeriodMarket = { junkQuery: true, phonesWorse: false };
  const phones: PeriodMarket = { junkQuery: false, phonesWorse: true };
  const key = { from: "2026-11-09", adId: "a1" };
  const sum = (rows: readonly { impressions: number; clicks: number; leads: number; spend: number }[]) =>
    rows.reduce((s, r) => ({ impressions: s.impressions + r.impressions, clicks: s.clicks + r.clicks, leads: s.leads + r.leads, spend: s.spend + r.spend }), { impressions: 0, clicks: 0, leads: 0, spend: 0 });

  it("makes the junk query of a key phrase with a word the key phrases do not have", () => {
    expect(junkQueryOf(["маникюр"])).toBe("маникюр фото");
    expect(junkQueryOf(["маникюр", "маникюр фото"])).toBe("маникюр идеи");
    // The wizard's usual negative words are not junk words; a launch negative phrase that cuts one skips it.
    expect(junkQueryOf(["маникюр"], ["обучение", "курсы", "вакансии", "своими руками", "бесплатно"])).toBe("маникюр фото");
    expect(junkQueryOf(["маникюр"], ["фото", "идеи"])).toBe("маникюр отзывы");
    expect(junkQueryOf(["маникюр у метро", "маникюр"])).toBe("маникюр фото");
    expect(junkQueryOf([])).toBeNull();
  });

  it("puts a quarter of a search ad's numbers on the junk query, without leads", () => {
    const totals = { impressions: 1_400, clicks: 70, leads: 7, spend: 420_000 };
    const split = splitPeriod(search, junk, totals, key);
    const junkRow = split.query.find((r) => r.segment === "маникюр фото");
    expect(junkRow).toMatchObject({ impressions: 350, leads: 0, spend: 105_000 });
    expect(junkRow?.clicks).toBeGreaterThanOrEqual(17);
    expect(sum(split.query)).toEqual(totals);
    expect(sum(split.device)).toEqual(totals);
    expect(splitPeriod(search, junk, totals, key)).toEqual(split);
  });

  it("takes the junk query away once a negative phrase matches it", () => {
    const totals = { impressions: 1_400, clicks: 70, leads: 7, spend: 420_000 };
    const split = splitPeriod({ ...search, negativeKeywords: ["фото"] }, junk, totals, key);
    expect(split.query).toEqual([{ segment: "маникюр", ...totals }]);
  });

  it("makes a lead from a phone about twice dearer than one from a computer on the training market", () => {
    const totals = { impressions: 3_000, clicks: 180, leads: 11, spend: 900_000 };
    const split = splitPeriod(search, MARKET, totals, key);
    const device = (segment: string) => split.device.find((r) => r.segment === segment);
    // Showings, clicks and spend keep the devices' shares; only the leads move.
    expect(device("mobile")?.spend).toBe(540_000);
    expect(device("desktop")?.spend).toBe(315_000);
    expect(device("tablet")?.spend).toBe(45_000);
    const cpl = (segment: string) => (device(segment)?.spend ?? 0) / Math.max(1, device(segment)?.leads ?? 0);
    expect(cpl("mobile") / cpl("desktop")).toBeGreaterThanOrEqual(1.5);
    expect(cpl("mobile") / cpl("desktop")).toBeLessThanOrEqual(3);
    expect(sum(split.device)).toEqual(totals);
  });

  it("puts the junk query and the phones on the training market without any mark", () => {
    const totals = { impressions: 1_400, clicks: 70, leads: 7, spend: 420_000 };
    const split = splitPeriod(search, MARKET, totals, key);
    expect(split.query.find((r) => r.segment === "маникюр фото")).toMatchObject({ spend: 105_000, leads: 0 });
    expect(sum(split.query)).toEqual(totals);
  });

  it("moves showings and click price with an adjustment as the market does", () => {
    const totals = { impressions: 8_500, clicks: 850, leads: 0, spend: 1_000_000 };
    const split = splitPeriod({ ...search, deviceAdjustments: { mobile: -25, desktop: 0 } }, NO_MARKET, totals, key);
    const device = (segment: string) => split.device.find((r) => r.segment === segment);
    // Phones: 0.60 × 0.75 = 0.45 of 0.85 of the showings, their click 12.5% cheaper.
    expect(device("mobile")?.clicks).toBe(450);
    expect(device("desktop")?.clicks).toBe(350);
    const price = (segment: string) => (device(segment)?.spend ?? 0) / (device(segment)?.clicks ?? 1);
    expect(price("mobile") / price("desktop")).toBeCloseTo(0.875, 2);
  });

  it("keeps an even market even: two weeks without marks give no device and no query above the goal", () => {
    const goal = 100_000;
    const weeks = ["2026-11-09", "2026-11-16"].map((from) => splitPeriod(search, NO_MARKET, { impressions: 1_400, clicks: 70, leads: 7, spend: 420_000 }, { from, adId: "a1" }));
    for (const dimension of ["device", "query"] as const) {
      const bySegment = new Map<string, { clicks: number; leads: number; spend: number }>();
      for (const week of weeks) {
        for (const r of week[dimension]) {
          const into = bySegment.get(r.segment) ?? { clicks: 0, leads: 0, spend: 0 };
          bySegment.set(r.segment, { clicks: into.clicks + r.clicks, leads: into.leads + r.leads, spend: into.spend + r.spend });
        }
      }
      for (const stats of bySegment.values()) expect(segmentVerdict(stats, goal)).not.toBe("above");
      if (dimension === "device") {
        expect(segmentVerdict(bySegment.get("mobile") ?? { clicks: 0, leads: 0, spend: 0 }, goal)).toBe("within");
        expect(segmentVerdict(bySegment.get("desktop") ?? { clicks: 0, leads: 0, spend: 0 }, goal)).toBe("within");
      }
    }
  });

  it("keeps leads ≤ clicks ≤ showings in a row and spend only with clicks, even on small numbers", () => {
    for (const totals of [
      { impressions: 3, clicks: 2, leads: 2, spend: 5_000 },
      { impressions: 9, clicks: 9, leads: 9, spend: 30_000 },
      { impressions: 40, clicks: 1, leads: 0, spend: 4_500 },
    ]) {
      for (const market of [NO_MARKET, junk, phones, { junkQuery: true, phonesWorse: true }]) {
        const split = splitPeriod({ ...search, keywords: ["маникюр", "маникюр у метро", "ногти"] }, market, totals, key);
        for (const dimension of ["device", "query"] as const) {
          expect(sum(split[dimension])).toEqual(totals);
          for (const r of split[dimension]) {
            expect(r.clicks).toBeLessThanOrEqual(r.impressions);
            expect(r.leads).toBeLessThanOrEqual(r.clicks);
            if (r.clicks === 0) expect(r.spend).toBe(0);
          }
        }
      }
    }
  });

  it("has no query rows for a network ad", () => {
    const split = splitPeriod({ ...search, keywords: [] }, junk, { impressions: 900, clicks: 9, leads: 1, spend: 18_000 }, key);
    expect(split.query).toEqual([]);
    expect(sum(split.device)).toEqual({ impressions: 900, clicks: 9, leads: 1, spend: 18_000 });
  });

  it("builds the window with each direction's key phrases, settings and junk query, always on the training market", () => {
    const traffic: Record<string, CampaignTrafficView> = {
      // «фото» was added later: the junk query is still «маникюр фото», now taken away.
      c1: { keywords: ["маникюр"], negativeKeywords: ["бесплатно", "фото"], deviceAdjustments: { mobile: -25, desktop: 0 }, launchNegativeKeywords: ["бесплатно"] },
      c2: { keywords: [], negativeKeywords: [], deviceAdjustments: { mobile: 0, desktop: 0 }, launchNegativeKeywords: [] },
    };
    const steps = [
      { kind: "period", state: "completed", days: 7, input: [{ adId: "a1", impressions: 100, clicks: 10, leads: 1, spendRub: 300 }], market: junk, traffic: { d1: search } },
      { kind: "period", state: "failed", days: 1, input: [], market: phones },
    ];
    const built = periodForm({
      state: {
        campaigns: [
          { id: "c1", name: "Поиск", channel: "search", status: "active", weeklyLimit: 420_000, strategyId: "WB_MAXIMUM_CLICKS" },
          { id: "c2", name: "Сайты", channel: "network", status: "active", weeklyLimit: 210_000, strategyId: "WB_MAXIMUM_CLICKS" },
        ] as never,
        ads: [
          { id: "p1", campaignId: "c1", status: "active", moderation: "accepted", monitoringStopped: false },
          { id: "p2", campaignId: "c2", status: "active", moderation: "accepted", monitoringStopped: false },
        ] as never,
      },
      room: (_id, dates) => dates.map(() => 10_000),
      traffic: (id) => traffic[id] ?? { ...search, launchNegativeKeywords: [] },
      directions: [
        { id: "d1", name: "Маникюр — Поиск", channel: "search", platformCampaignId: "c1" },
        { id: "d2", name: "Маникюр — Сайты-партнёры", channel: "network", platformCampaignId: "c2" },
      ],
      ads: [
        { id: "a1", title: "Маникюр", directionId: "d1", platformAdId: "p1" },
        { id: "n1", title: "Ноготок", directionId: "d2", platformAdId: "p2" },
      ],
      start: new Date("2026-11-09T06:00:00Z"),
      timeZone: "Europe/Moscow",
      last: lastEntered(steps),
    });
    // The marks of earlier periods do not carry over: the market is the same for every period now.
    expect(built.market).toEqual(MARKET);
    expect(built.directions[0]).toMatchObject({ keywords: ["маникюр"], negativeKeywords: ["бесплатно", "фото"], deviceAdjustments: { mobile: -25, desktop: 0 }, junkQuery: "маникюр фото" });
    expect(built.directions[0]?.ads[0]?.last).toMatchObject({ market: junk, traffic: search });
    expect(built.directions[1]).toMatchObject({ keywords: [], junkQuery: null });
  });

  it("fills a cheaper lead once the junk query is taken away, whatever the noise", () => {
    const last = { days: 7, impressions: 1_400, clicks: 70, leads: 5, spendRub: 4_200, market: junk, traffic: search };
    for (const from of ["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14"]) {
      const window = form({ a1: last });
      window.from = from;
      window.market = junk;
      const d1 = window.directions[0];
      if (d1 === undefined) throw new Error("no direction");
      window.directions[0] = { ...d1, ads: d1.ads.slice(0, 1), negativeKeywords: ["фото"], roomRub: { 1: 2_000, 3: 6_000, 7: 14_000, 14: 28_000 } };
      const row = suggestPeriod(window, 7).find((r) => r.adId === "a1");
      expect(row?.leads ?? 0).toBeGreaterThan(0);
      expect((row?.spendRub ?? 0) / (row?.leads ?? 1)).toBeLessThan(4_200 / 5);
      expect(checkPeriod(window, 7, suggestPeriod(window, 7))).toEqual({ errors: [], changed: false });
    }
  });

});
