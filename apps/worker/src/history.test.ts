import { IdlePolicy } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { describe, expect, it } from "vitest";
import { ACTION_META, inverseCommands, recordOutcomes, rollback } from "./history";
import { SimulationDriver } from "./simulation";

const good = { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) };
const bad = { impressionsPerDay: 800, ctr: 0.06, cr: 0, costPerClick: rubles(30) };

const world = async () => {
  const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 3, agent: new IdlePolicy() });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: 30_000,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [
      { name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth: good }, { title: "Маникюр без записи", truth: bad }] },
    ],
  });
  return sim;
};

const user = (sim: SimulationDriver, command: Parameters<SimulationDriver["executor"]["execute"]>[0]["command"]) =>
  sim.executor.execute({ businessId: "b1", command, actor: "user", reasonCode: "USER_CHANGE", explanation: "Вы изменили настройки" });

describe("rollback", () => {
  it("restores a paused ad, marks the entry reverted and stops the safety net from repeating it for 14 days", async () => {
    const sim = await world();
    await sim.runDays(14);
    const badAd = (await sim.store.ads("b1")).find((a) => a.title === "Маникюр без записи");
    const pause = (await sim.store.changes("b1")).find((c) => c.objectId === badAd?.id && c.actor === "safety_net");
    expect(pause).toBeDefined();

    const result = await rollback(sim.ctx, { businessId: "b1", entryId: pause?.id ?? "" });
    expect(result.kind).toBe("done");
    expect((await sim.store.ads("b1")).find((a) => a.id === badAd?.id)?.status).toBe("active");
    const entries = await sim.store.changes("b1");
    expect(entries.find((c) => c.id === pause?.id)?.revertedById).not.toBeNull();
    expect(entries.at(-1)?.explanation).toMatch(/^Вы отменили изменение: Отключил объявление «Маникюр без записи»/);

    await sim.runDays(3);
    expect((await sim.store.ads("b1")).find((a) => a.id === badAd?.id)?.status).toBe("active");
  });

  it("asks to roll back later changes of the same object together, newest first", async () => {
    const sim = await world();
    await user(sim, { type: "SetSpendLimit", directionId: "b1-d1", weeklyLimit: rubles(1_500) });
    await user(sim, { type: "SetSpendLimit", directionId: "b1-d1", weeklyLimit: rubles(1_000) });
    const [first] = await sim.store.changes("b1");

    const ask = await rollback(sim.ctx, { businessId: "b1", entryId: first?.id ?? "" });
    expect(ask).toMatchObject({ kind: "needs_chain" });
    expect(ask.kind === "needs_chain" ? ask.later : []).toHaveLength(1);

    expect((await rollback(sim.ctx, { businessId: "b1", entryId: first?.id ?? "", includeLater: true })).kind).toBe("done");
    expect((await sim.store.directions("b1"))[0]?.weeklyLimit).toBe(rubles(2_000));
  });

  it("shows the difference when the cabinet state changed, and rolls back after confirmation", async () => {
    const sim = await world();
    await user(sim, { type: "PauseAd", adId: "b1-d1-a1" });
    const [entry] = await sim.store.changes("b1");
    const ad = (await sim.store.ads("b1"))[0];
    sim.platform.cabinetEditAd(ad?.platformAdId ?? "", { text: "Новый текст из кабинета" });

    const result = await rollback(sim.ctx, { businessId: "b1", entryId: entry?.id ?? "" });
    expect(result).toMatchObject({ kind: "state_differs", actual: { text: "Новый текст из кабинета" } });
    expect((await rollback(sim.ctx, { businessId: "b1", entryId: entry?.id ?? "", confirmDifference: true })).kind).toBe("done");
    expect((await sim.store.ads("b1"))[0]?.status).toBe("active");
  });

  it("explains why an irreversible change has no rollback", async () => {
    const sim = await world();
    await sim.executor.execute({
      businessId: "b1",
      command: { type: "StartExperiment", directionId: "b1-d1", adId: "b1-d1-a1", hypothesis: "Проверяем оффер" },
      actor: "safety_net",
      reasonCode: "SAFETY_START_EXPERIMENT",
      explanation: "Запустил проверку",
    });
    const [entry] = await sim.store.changes("b1");
    expect(await rollback(sim.ctx, { businessId: "b1", entryId: entry?.id ?? "" })).toMatchObject({ kind: "not_reversible" });
    expect(ACTION_META.StartExperiment.irreversibleReason).toBeTruthy();
  });

  it("builds inverse commands from the before snapshot", () => {
    const base = { id: "c", businessId: "b1", actor: "user" as const, author: "user" as const, status: "applied" as const, reasonCode: "", explanation: "", turnId: null, createdAt: new Date(), error: null, revertedById: null, outcome: null };
    expect(
      inverseCommands({ ...base, action: { type: "UpdateSchedule", directionId: "d", schedule: "Пн–Пт" }, objectKind: "direction", objectId: "d", before: { status: "active", weeklyLimit: 1, strategyId: "s", schedule: "Пн–Вс" }, after: { status: "active", weeklyLimit: 1, strategyId: "s", schedule: "Пн–Пт" } }),
    ).toEqual([{ type: "UpdateSchedule", directionId: "d", schedule: "Пн–Вс" }]);
  });
});

describe("«Что стало после»", () => {
  it("is filled 7 days after an automated change", async () => {
    const sim = await world();
    await sim.runDays(20);
    await recordOutcomes(sim.ctx, "b1");
    const pause = (await sim.store.changes("b1")).find((c) => c.actor === "safety_net" && c.reasonCode === "SAFETY_PAUSE_AD");
    expect(pause?.outcome).toMatch(/^За неделю после изменения: обращений \d+ \(было \d+\), стоимость обращения/);
  });
});
