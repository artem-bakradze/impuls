import { describe, expect, it } from "vitest";
import type { AdTruth } from "./simulator";
import { SimulatedPlatform } from "./simulator";
import { allocate } from "./simulator-segments";

const START = new Date("2026-10-01T00:00:00Z").getTime();
const HOUR = 3_600_000;

/** «Маникюр бесплатно» is 30% of the traffic and brings no leads; phones lead half as often as computers. */
const junky: AdTruth = {
  impressionsPerDay: 3_000,
  ctr: 0.06,
  cr: 0.08,
  costPerClick: 3_000,
  devices: { mobile: { share: 0.6, crFactor: 0.5 }, desktop: { share: 0.35, crFactor: 1.6 }, tablet: { share: 0.05 } },
  queries: [
    { text: "маникюр москва", share: 0.5, crFactor: 1.4 },
    { text: "маникюр у метро", share: 0.2, crFactor: 1.4 },
    { text: "маникюр бесплатно", share: 0.3, crFactor: 0 },
  ],
};

const plain: AdTruth = { impressionsPerDay: 3_000, ctr: 0.06, cr: 0.08, costPerClick: 3_000 };

const market = (truth: AdTruth) => {
  const clock = { now: START };
  const platform = new SimulatedPlatform({ seed: 5, timeZone: "Europe/Moscow", now: () => new Date(clock.now), truthFor: () => truth, maxStatsDelayHours: 0 });
  const days = (n: number) => {
    for (let h = 0; h < n * 24; h++) {
      clock.now += HOUR;
      platform.advanceHour(new Date(clock.now));
    }
  };
  return { platform, clock, days };
};

const launch = async (platform: SimulatedPlatform) => {
  const campaign = await platform.createCampaign({
    name: "Маникюр — Поиск",
    channel: "search",
    weeklyLimit: 10_000_000,
    strategyId: "WB_MAXIMUM_CLICKS",
    siteMonitoring: true,
    targeting: { city: "Москва", keywords: ["маникюр москва", "маникюр у метро"], negativeKeywords: [] },
    schedule: "Пн–Вс 10:00–22:00",
  });
  await platform.createAd({ campaignId: campaign.id, title: "Маникюр у метро", text: "Запись онлайн", landingUrl: "https://nogotok.example" });
  return campaign.id;
};

const sum = (rows: readonly { impressions: number; clicks: number; leads: number; spend: number }[]) =>
  rows.reduce((s, r) => ({ impressions: s.impressions + r.impressions, clicks: s.clicks + r.clicks, leads: s.leads + r.leads, spend: s.spend + r.spend }), { impressions: 0, clicks: 0, leads: 0, spend: 0 });

describe("simulator truth by device and query (testing-harness spec)", () => {
  it("splits every day's stats by device and by query so that they add up to the daily stats", async () => {
    const { platform, days } = market(junky);
    const id = await launch(platform);
    days(7);
    for (const date of ["2026-10-01", "2026-10-04", "2026-10-07"]) {
      const total = sum(await platform.getStats([id], date, date));
      expect(sum(await platform.getBreakdown([id], date, date, "device"))).toEqual(total);
      expect(sum(await platform.getBreakdown([id], date, date, "query"))).toEqual(total);
    }
    const devices = await platform.getBreakdown([id], "2026-10-01", "2026-10-07", "device");
    expect(devices.map((d) => d.segment).sort()).toEqual(["desktop", "mobile", "tablet"]);
    const mobile = devices.find((d) => d.segment === "mobile");
    const desktop = devices.find((d) => d.segment === "desktop");
    // Phones bring leads more expensively than computers, as the truth says.
    expect((mobile?.spend ?? 0) / Math.max(1, mobile?.leads ?? 0)).toBeGreaterThan((desktop?.spend ?? 0) / Math.max(1, desktop?.leads ?? 0));
    const free = (await platform.getBreakdown([id], "2026-10-01", "2026-10-07", "query")).find((q) => q.segment === "маникюр бесплатно");
    expect(free?.spend).toBeGreaterThan(0);
    expect(free?.leads).toBe(0);
  });

  it("stops the traffic of a negative phrase from the next hour and makes a lead cheaper", async () => {
    const { platform, days } = market(junky);
    const id = await launch(platform);
    days(7);
    await platform.updateCampaign(id, { negativeKeywords: ["бесплатно"] });
    expect((await platform.getTrafficSettings([id]))[0]).toEqual({ campaignId: id, negativeKeywords: ["бесплатно"], deviceAdjustments: { mobile: 0, desktop: 0 } });
    days(7);
    // The change came at 03:00 Moscow time on 10-08, so whole days without the phrase start on 10-09.
    const after = (await platform.getBreakdown([id], "2026-10-09", "2026-10-14", "query")).find((q) => q.segment === "маникюр бесплатно");
    expect(after?.spend ?? 0).toBe(0);
    const cpl = async (from: string, to: string) => {
      const t = sum(await platform.getStats([id], from, to));
      return t.spend / t.leads;
    };
    expect(await cpl("2026-10-09", "2026-10-14")).toBeLessThan(await cpl("2026-10-01", "2026-10-07"));
  });

  it("shows phones less and cheaper after a lower bid adjustment", async () => {
    const { platform, days } = market(junky);
    const id = await launch(platform);
    days(7);
    await platform.updateCampaign(id, { deviceAdjustments: { mobile: -50, desktop: 0 } });
    days(7);
    const share = async (from: string, to: string) => {
      const rows = await platform.getBreakdown([id], from, to, "device");
      return (rows.find((r) => r.segment === "mobile")?.impressions ?? 0) / sum(rows).impressions;
    };
    expect(await share("2026-10-08", "2026-10-14")).toBeLessThan(await share("2026-10-01", "2026-10-07"));
  });

  it("keeps the old traffic exactly when the settings are neutral, and does not store cells by segment", async () => {
    const a = market(junky);
    const b = market(plain);
    const idA = await launch(a.platform);
    const idB = await launch(b.platform);
    a.days(5);
    b.days(5);
    expect(await a.platform.getStats([idA], "2026-10-01", "2026-10-05")).toEqual(await b.platform.getStats([idB], "2026-10-01", "2026-10-05"));
    expect(a.platform.snapshot().cells.length).toBe(b.platform.snapshot().cells.length);
  });

  it("repeats a breakdown exactly after restore", async () => {
    const { platform, clock, days } = market(junky);
    const id = await launch(platform);
    days(3);
    await platform.updateCampaign(id, { negativeKeywords: ["бесплатно"] });
    days(2);
    const other = market(junky);
    other.clock.now = clock.now;
    const copy = other.platform;
    copy.restore(platform.snapshot());
    expect(await copy.getBreakdown([id], "2026-10-01", "2026-10-05", "query")).toEqual(await platform.getBreakdown([id], "2026-10-01", "2026-10-05", "query"));
  });

  it("allocates integer amounts that add up exactly", () => {
    expect(allocate(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocate(7, [0.5, 0.3, 0.2])).toEqual([4, 2, 1]);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
  });
});
