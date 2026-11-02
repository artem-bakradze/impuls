import { AdversarialPolicy } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { describe, expect, it } from "vitest";
import { deleteAccount, purgeDeletedAccounts, purgeOldTurns } from "./account";
import { SimulationDriver } from "./simulation";
import type { MemoryStore } from "./store";

describe("agent journal retention", () => {
  it("keeps turns for 90 days and removes older ones", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 5, agent: new AdversarialPolicy() });
    await sim.launchBusiness({
      id: "b1",
      monthlyBudgetRub: 30_000,
      launchedOn: "2026-10-01",
      csoSource: { kind: "user", goal: rubles(800) },
      directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth: { impressionsPerDay: 100, ctr: 0.05, cr: 0.05, costPerClick: rubles(20) } }] }],
    });
    // The first turn is Monday's review: 2026-10-01 is a Thursday, and the agent is called on reasons the other days.
    await sim.runDays(5);
    const first = (await sim.store.turns("b1"))[0];
    expect(first).toBeDefined();
    const day = 86_400_000;
    sim.clock.set(new Date((first?.startedAt.getTime() ?? 0) + 89 * day));
    expect(await purgeOldTurns(sim.ctx)).toBe(0);
    sim.clock.set(new Date((first?.startedAt.getTime() ?? 0) + 91 * day));
    expect(await purgeOldTurns(sim.ctx)).toBeGreaterThan(0);
    expect((await sim.store.turns("b1")).some((t) => t.id === first?.id)).toBe(false);
  });
});

describe("account deletion on the simulator", () => {
  it("stops campaigns, revokes tokens, keeps the agent off and purges personal data after 30 days", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 5, agent: new AdversarialPolicy() });
    await sim.launchBusiness({
      id: "b1",
      monthlyBudgetRub: 30_000,
      launchedOn: "2026-10-01",
      csoSource: { kind: "user", goal: rubles(800) },
      directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth: { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) } }] }],
    });
    const store = sim.store as MemoryStore;
    store.emails.set("b1", "owner@example.com");
    await sim.runDays(3);

    expect(await deleteAccount(sim.ctx, "b1")).toEqual({ message: "Реклама остановлена, данные будут удалены" });
    const campaigns = await sim.platform.getCampaigns((await store.directions("b1")).map((d) => d.platformCampaignId));
    expect(campaigns.every((c) => c.status === "paused")).toBe(true);
    expect(store.revokedAccounts.has("b1")).toBe(true);

    const turnsBefore = (await store.turns("b1")).length;
    await sim.runDays(29);
    expect((await store.turns("b1")).length).toBe(turnsBefore);
    expect(await store.ownerEmail("b1")).toBe("owner@example.com");
    await sim.runDays(2); // the hourly dispatcher purges after 30 days
    expect(await purgeDeletedAccounts(sim.ctx)).toBe(0);
    // The new month does not bring the deleted account's ads back.
    expect((await store.directions("b1")).every((d) => d.status === "paused")).toBe(true);
    await expect(store.ownerEmail("b1")).rejects.toThrow();
  });
});
