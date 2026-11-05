import { describe, expect, it } from "vitest";
import { weekStart } from "@impuls/core";
import { periodRoom, SimulatedPlatform } from "./simulator";

const campaign = {
  name: "[Импульс] Маникюр — Поиск",
  channel: "search" as const,
  weeklyLimit: 50_000,
  strategyId: "WB_MAXIMUM_CLICKS",
  siteMonitoring: true,
  targeting: { city: "Москва", keywords: ["маникюр"], negativeKeywords: [] },
  schedule: "Пн–Вс 10:00–22:00",
};

const simulator = (idPrefix?: string) =>
  new SimulatedPlatform({
    seed: 1,
    timeZone: "Europe/Moscow",
    now: () => new Date("2026-10-29T09:00:00Z"),
    truthFor: () => ({ impressionsPerDay: 100, ctr: 0.05, cr: 0.05, costPerClick: 2_000 }),
    ...(idPrefix !== undefined && { idPrefix }),
  });

describe("SimulatedPlatform ids", () => {
  it("does not repeat campaign ids of a previous start when a per-start prefix is given", async () => {
    const before = await simulator("runA-").createCampaign(campaign);
    const after = await simulator("runB-").createCampaign(campaign);
    expect(before.id).toBe("runA-c-1");
    expect(after.id).not.toBe(before.id);
  });

  it("keeps the plain deterministic ids used by tests without a prefix", async () => {
    expect((await simulator().createCampaign(campaign)).id).toBe("c-1");
  });
});

describe("SimulatedPlatform state", () => {
  const start = new Date("2026-10-01T00:00:00Z").getTime();
  const world = (clock: { now: number }) =>
    new SimulatedPlatform({
      seed: 7,
      timeZone: "Europe/Moscow",
      now: () => new Date(clock.now),
      truthFor: () => ({ impressionsPerDay: 2_000, ctr: 0.05, cr: 0.05, costPerClick: 2_000 }),
    });
  const run = (sim: SimulatedPlatform, clock: { now: number }, hours: number) => {
    for (let h = 0; h < hours; h++) {
      clock.now += 3_600_000;
      sim.advanceHour(new Date(clock.now));
    }
  };
  const setUp = async (sim: SimulatedPlatform) => {
    const created = await sim.createCampaign(campaign);
    for (let i = 0; i < 6; i++) await sim.createAd({ campaignId: created.id, title: `Маникюр ${i}`, text: "У метро", landingUrl: "https://nogotok.example" });
    return created.id;
  };

  it("continues exactly after snapshot and restore", async () => {
    const straightClock = { now: start };
    const straight = world(straightClock);
    const id = await setUp(straight);
    run(straight, straightClock, 240);

    const firstClock = { now: start };
    const first = world(firstClock);
    await setUp(first);
    run(first, firstClock, 120);
    const restoredClock = { now: firstClock.now };
    const restored = world(restoredClock);
    restored.restore(JSON.parse(JSON.stringify(first.snapshot())) as ReturnType<SimulatedPlatform["snapshot"]>);
    run(restored, restoredClock, 120);

    expect(await restored.getStats([id], "2026-10-01", "2026-10-11")).toEqual(await straight.getStats([id], "2026-10-01", "2026-10-11"));
    expect(await restored.getBalance()).toBe(await straight.getBalance());
  });

  it("keeps the state small by merging old hours into days", async () => {
    const clock = { now: start };
    const sim = world(clock);
    await setUp(sim);
    run(sim, clock, 60 * 24);
    expect(JSON.stringify(sim.snapshot()).length).toBeLessThan(200_000);
  });
});

describe("Period entered by the owner", () => {
  const owned = (clock: { now: number }) =>
    new SimulatedPlatform({ seed: 3, timeZone: "Europe/Moscow", now: () => new Date(clock.now), truthFor: () => null });
  const dates = (from: string, n: number) =>
    Array.from({ length: n }, (_, i) => new Date(new Date(`${from}T00:00:00Z`).getTime() + i * 86_400_000).toISOString().slice(0, 10));
  const setUp = async (sim: SimulatedPlatform, weeklyLimit = 420_000) => {
    const created = await sim.createCampaign({ ...campaign, weeklyLimit });
    const a = await sim.createAd({ campaignId: created.id, title: "Маникюр с покрытием", text: "У метро", landingUrl: "https://nogotok.example" });
    const b = await sim.createAd({ campaignId: created.id, title: "Маникюр за час", text: "У метро", landingUrl: "https://nogotok.example" });
    return { campaignId: created.id, a: a.id, b: b.id };
  };

  it("gives a week inside one Monday week its whole limit", () => {
    // Monday 2 November 2026 → Sunday 8 November.
    const room = periodRoom(420_000, dates("2026-11-02", 7), () => 0, () => 0);
    expect(room.reduce((s, r) => s + r, 0)).toBe(420_000);
    expect(Math.max(...room)).toBeLessThanOrEqual(120_000);
  });

  it("counts a week through Monday by both weeks and what the first one already spent", () => {
    // Thursday 5 November → Wednesday 11 November: 4 days of a week that spent 300 000, 3 days of the next one.
    const room = periodRoom(420_000, dates("2026-11-05", 7), () => 0, (monday) => (monday === "2026-11-02" ? 300_000 : 0));
    expect(room.slice(0, 4).reduce((s, r) => s + r, 0)).toBe(120_000);
    expect(room.slice(4).reduce((s, r) => s + r, 0)).toBe(360_000);
  });

  it("records the entered totals exactly, visible at once, without a breakdown", async () => {
    const clock = { now: new Date("2026-11-09T06:00:00Z").getTime() };
    const sim = owned(clock);
    const { campaignId, a, b } = await setUp(sim);
    const days = dates("2026-11-09", 7);
    sim.recordPeriod(days, [
      { adId: a, impressions: 1_400, clicks: 70, leads: 0, spend: 153_000 },
      { adId: b, impressions: 9, clicks: 5, leads: 3, spend: 4_001 },
    ]);
    const rows = await sim.getStats([campaignId], days[0] ?? "", days[6] ?? "");
    const total = (adId: string) =>
      rows.filter((r) => r.adId === adId).reduce((s, r) => ({ impressions: s.impressions + r.impressions, clicks: s.clicks + r.clicks, leads: s.leads + r.leads, spend: s.spend + r.spend }), { impressions: 0, clicks: 0, leads: 0, spend: 0 });
    expect(total(a)).toEqual({ impressions: 1_400, clicks: 70, leads: 0, spend: 153_000 });
    expect(total(b)).toEqual({ impressions: 9, clicks: 5, leads: 3, spend: 4_001 });
    for (const row of rows) {
      expect(row.clicks).toBeLessThanOrEqual(row.impressions);
      expect(row.leads).toBeLessThanOrEqual(row.clicks);
    }
    const room = sim.roomOf(campaignId, days);
    expect(room.reduce((s, r) => s + r, 0)).toBe(420_000 - 157_001);
    expect(await sim.getBreakdown([campaignId], days[0] ?? "", days[6] ?? "", "device")).toEqual([]);
    expect(await sim.getBalance()).toBe(100_000_000 - 157_001);
  });

  it("keeps every day and week under the limit when the whole room is spent", async () => {
    const clock = { now: new Date("2026-11-05T06:00:00Z").getTime() };
    const sim = owned(clock);
    const { campaignId, a } = await setUp(sim);
    const days = dates("2026-11-05", 14);
    const room = sim.roomOf(campaignId, days);
    sim.recordPeriod(days, [{ adId: a, impressions: 5_000, clicks: 400, leads: 9, spend: room.reduce((s, r) => s + r, 0) }]);
    const rows = await sim.getStats([campaignId], days[0] ?? "", days[13] ?? "");
    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.spend);
    // A day at most twice an average day of the weekly limit (420 000), a week from Monday at most the limit.
    days.forEach((date) => expect(byDay.get(date) ?? 0).toBeLessThanOrEqual(120_000));
    const byWeek = new Map<string, number>();
    for (const [date, spend] of byDay) byWeek.set(weekStart(date), (byWeek.get(weekStart(date)) ?? 0) + spend);
    for (const spend of byWeek.values()) expect(spend).toBeLessThanOrEqual(420_000);
    expect(sim.roomOf(campaignId, days).every((r) => r === 0)).toBe(true);
  });

  it("spreads a week's spend over all its days, not only until the weekly limit runs out", async () => {
    // Monday 9 November: the daily cap would fill the week's limit by Thursday if spend followed the room.
    const clock = { now: new Date("2026-11-09T06:00:00Z").getTime() };
    const sim = owned(clock);
    const { campaignId, a } = await setUp(sim, 162_000);
    const days = dates("2026-11-09", 7);
    sim.recordPeriod(days, [{ adId: a, impressions: 1_400, clicks: 70, leads: 3, spend: 140_000 }]);
    const rows = await sim.getStats([campaignId], days[0] ?? "", days[6] ?? "");
    const byDay = days.map((date) => rows.filter((r) => r.date === date).reduce((s, r) => s + r.spend, 0));
    expect(byDay).toEqual([20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000]);
  });

  it("refuses spend over the room", async () => {
    const clock = { now: new Date("2026-11-09T06:00:00Z").getTime() };
    const sim = owned(clock);
    const { a } = await setUp(sim);
    expect(() => sim.recordPeriod(dates("2026-11-09", 7), [{ adId: a, impressions: 100, clicks: 10, leads: 0, spend: 500_000 }])).toThrow(/over its room/);
  });
});
