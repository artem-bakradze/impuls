import { IdlePolicy } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { beforeEach, describe, expect, it } from "vitest";
import { SimulationDriver } from "./simulation";

const truth = { impressionsPerDay: 600, ctr: 0.05, cr: 0.08, costPerClick: rubles(25) };

const setup = async () => {
  const sim = new SimulationDriver({ start: new Date("2026-10-05T03:00:00Z"), seed: 1, agent: new IdlePolicy() });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: 30_000,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [
      { name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth }, { title: "Маникюр 1 800 ₽", truth }] },
      { name: "Педикюр — Поиск", weeklyLimitRub: 1_500, ads: [{ title: "Педикюр", truth }] },
    ],
  });
  return sim;
};

describe("CommandExecutor", () => {
  let sim: SimulationDriver;
  beforeEach(async () => {
    sim = await setup();
  });

  it("writes pending first and marks the entry applied after the platform call", async () => {
    const result = await sim.executor.execute({
      businessId: "b1",
      command: { type: "PauseAd", adId: "b1-d1-a1" },
      actor: "user",
      reasonCode: "USER_PAUSE",
      explanation: "Вы отключили объявление",
    });
    expect(result.status).toBe("applied");
    const [entry] = await sim.store.changes("b1");
    expect(entry).toMatchObject({ status: "applied", author: "user", before: { status: "active" }, after: { status: "paused" } });
  });

  it("executes concurrent commands of one business one by one, each guard seeing the previous result", async () => {
    // Budget allows ~ (27 000 − spent) / 4 weeks ≈ 6 750 ₽ of weekly limits in total.
    const raise = (directionId: string, rub: number) =>
      sim.executor.execute({
        businessId: "b1",
        command: { type: "SetSpendLimit", directionId, weeklyLimit: rubles(rub) },
        actor: "user",
        reasonCode: "USER_LIMIT",
        explanation: "Вы изменили лимит",
      });
    const results = await Promise.all([raise("b1-d1", 5_000), raise("b1-d2", 5_000)]);
    expect(results.map((r) => r.status).sort()).toEqual(["applied", "clamped"]);
    const total = (await sim.store.directions("b1")).reduce((sum, d) => sum + d.weeklyLimit, 0);
    expect(total).toBeLessThanOrEqual(rubles(6_750));
  });

  it("rejects a command when the platform state differs from the expected before", async () => {
    sim.platform.cabinetEditAd((await sim.store.ads("b1"))[0]!.platformAdId, { status: "paused" });
    const result = await sim.executor.execute({
      businessId: "b1",
      command: { type: "PauseAd", adId: "b1-d1-a1" },
      actor: "agent",
      reasonCode: "AGENT_PAUSE",
      explanation: "Отключил объявление",
    });
    expect(result).toMatchObject({ status: "rejected", code: "STATE_CHANGED" });
    expect(await sim.store.changes("b1")).toHaveLength(0);
  });

  it("recovers a pending entry left by a crash after the platform call, without a duplicate", async () => {
    const [direction] = await sim.store.directions("b1");
    // Simulate: entry written, platform changed, worker died before marking the result.
    await sim.store.appendChange({
      businessId: "b1",
      actor: "agent",
      author: "service",
      action: { type: "SetSpendLimit", directionId: direction!.id, weeklyLimit: rubles(1_000) },
      objectKind: "direction",
      objectId: direction!.id,
      before: { status: "active", weeklyLimit: direction!.weeklyLimit, strategyId: direction!.strategyId },
      after: { status: "active", weeklyLimit: direction!.weeklyLimit, strategyId: direction!.strategyId },
      status: "pending",
      reasonCode: "AGENT_LIMIT",
      explanation: "Снизил лимит",
      turnId: null,
      createdAt: sim.clock.now(),
      error: null,
    });
    await sim.platform.updateCampaign(direction!.platformCampaignId, { weeklyLimit: rubles(1_000) });
    sim.clock.advanceHours(1);
    expect(await sim.executor.recoverPending(5 * 60_000)).toBe(1);
    const entries = await sim.store.changes("b1");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "applied", after: { weeklyLimit: rubles(1_000) } });
    expect((await sim.store.directions("b1"))[0]!.weeklyLimit).toBe(rubles(1_000));
  });

  it("marks a pending entry failed when the platform never applied it", async () => {
    const [direction] = await sim.store.directions("b1");
    await sim.store.appendChange({
      businessId: "b1",
      actor: "agent",
      author: "service",
      action: { type: "PauseDirection", directionId: direction!.id },
      objectKind: "direction",
      objectId: direction!.id,
      before: { status: "active", weeklyLimit: direction!.weeklyLimit, strategyId: direction!.strategyId },
      after: { status: "active", weeklyLimit: direction!.weeklyLimit, strategyId: direction!.strategyId },
      status: "pending",
      reasonCode: "AGENT_PAUSE",
      explanation: "Остановил направление",
      turnId: null,
      createdAt: sim.clock.now(),
      error: null,
    });
    sim.clock.advanceHours(1);
    await sim.executor.recoverPending(5 * 60_000);
    expect((await sim.store.changes("b1"))[0]).toMatchObject({ status: "failed" });
  });
});
