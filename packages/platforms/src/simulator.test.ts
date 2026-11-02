import { describe, expect, it } from "vitest";
import { SimulatedPlatform } from "./simulator";

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
