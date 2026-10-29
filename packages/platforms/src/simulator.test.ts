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
