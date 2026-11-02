import { IdlePolicy } from "@impuls/agent";
import { analystDecisionKey, rubles } from "@impuls/core";
import type { Command } from "@impuls/core";
import type { AdTruth } from "@impuls/platforms";
import { describe, expect, it } from "vitest";
import { inverseCommands, rollback } from "./history";
import { reconcile } from "./jobs";
import { SimulationDriver } from "./simulation";

/** Half of the traffic comes from «бесплатно» and «обучение», which never bring leads; phones lead worse than computers. */
const junky: AdTruth = {
  impressionsPerDay: 800,
  ctr: 0.06,
  cr: 0.1,
  costPerClick: rubles(20),
  queries: [
    { text: "маникюр у метро", share: 0.3, crFactor: 1.6 },
    { text: "маникюр с покрытием", share: 0.2, crFactor: 1.6 },
    { text: "маникюр бесплатно", share: 0.25, crFactor: 0 },
    { text: "маникюр обучение", share: 0.25, crFactor: 0 },
  ],
  devices: { mobile: { share: 0.6, crFactor: 0.4 }, desktop: { share: 0.35, crFactor: 1.8 }, tablet: { share: 0.05 } },
};

const world = async () => {
  const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 3, agent: new IdlePolicy() });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: 30_000,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: 3_000, keywords: ["маникюр у метро", "маникюр рядом"], ads: [{ title: "Маникюр у метро", truth: junky }] }],
  });
  return sim;
};

const agent = (sim: SimulationDriver, command: Command) =>
  sim.executor.execute({ businessId: "b1", command, actor: "agent", reasonCode: "AGENT_ACTION", explanation: "Агент убрал запрос, который не приводит клиентов", turnId: "turn-1" });

const negative = (...phrases: string[]): Command => ({ type: "AddNegativeKeywords", directionId: "b1-d1", phrases });

/** The agent's entries of one command type, oldest first (the budget guard writes its own limit entries too). */
const entriesOf = async (sim: SimulationDriver, type: Command["type"]) => (await sim.store.changes("b1")).filter((c) => c.action.type === type && c.actor === "agent");

const campaignId = async (sim: SimulationDriver) => (await sim.store.directions("b1"))[0]?.platformCampaignId ?? "";

/** The cabinet change happened after the last reconciliation: the Changes cursor is moved back before it. */
const reconcileCabinet = async (sim: SimulationDriver) => {
  await sim.store.setCursor("b1", "changes", new Date(sim.clock.now().getTime() - 60_000));
  await reconcile(sim.ctx, "b1");
};

describe("negative phrases through the executor (add-agent-analyst-stage1)", () => {
  it("adds a phrase checked against a fresh breakdown, keeps the others and stops its queries", async () => {
    const sim = await world();
    await sim.runDays(14);
    const result = await agent(sim, negative("Бесплатно"));
    expect(result).toMatchObject({ status: "applied", command: { phrases: ["бесплатно"] } });

    expect((await sim.platform.getTrafficSettings([await campaignId(sim)]))[0]?.negativeKeywords).toEqual(["бесплатно"]);
    expect((await sim.store.directions("b1"))[0]?.negativeKeywords).toEqual(["бесплатно"]);
    const entry = (await entriesOf(sim, "AddNegativeKeywords")).at(-1);
    expect(entry).toMatchObject({ status: "applied", before: { negativeKeywords: "[]" }, after: { negativeKeywords: '["бесплатно"]' } });

    await sim.runDays(3);
    const free = (await sim.platform.getBreakdown([await campaignId(sim)], "2026-10-17", "2026-10-17", "query")).find((q) => q.segment === "маникюр бесплатно");
    expect(free?.spend ?? 0).toBe(0);
  });

  it("refuses phrases that would switch off the own queries, cut good queries, or have little data", async () => {
    const sim = await world();
    await sim.runDays(1);
    expect(await agent(sim, negative("бесплатно"))).toMatchObject({ status: "rejected", message: "по этому запросу ещё мало данных" });
    await sim.runDays(13);
    expect(await agent(sim, negative("маникюр"))).toMatchObject({ status: "rejected", message: "эта минус-фраза отключит показы по вашим основным запросам" });
    expect(await agent(sim, negative("покрытием"))).toMatchObject({ status: "rejected", message: "этот запрос приводит обращения в цели" });
    expect(await agent(sim, negative("курсы"))).toMatchObject({ status: "rejected", message: "такого поискового запроса у рекламы нет" });
    expect(await entriesOf(sim, "AddNegativeKeywords")).toHaveLength(0);
  });

  it("checks the expected list against the cabinet and takes a cabinet change into the history", async () => {
    const sim = await world();
    await sim.runDays(14);
    sim.platform.cabinetEditCampaign(await campaignId(sim), { negativeKeywords: ["вакансии"] });
    expect(await agent(sim, negative("бесплатно"))).toMatchObject({ status: "rejected", code: "STATE_CHANGED" });

    await reconcileCabinet(sim);
    const cabinet = (await sim.store.changes("b1")).filter((c) => c.author === "cabinet").at(-1);
    expect(cabinet).toMatchObject({
      author: "cabinet",
      action: { type: "ExternalChange" },
      before: { negativeKeywords: "[]" },
      after: { negativeKeywords: '["вакансии"]' },
      explanation: "Изменено в кабинете Директа: минус-фразы направления «Маникюр — Поиск».",
    });
    expect(await agent(sim, negative("бесплатно"))).toMatchObject({ status: "applied" });
    expect((await sim.platform.getTrafficSettings([await campaignId(sim)]))[0]?.negativeKeywords).toEqual(["вакансии", "бесплатно"]);
  });

  it("rolls back one phrase without the later one, and the agent keeps away from it", async () => {
    const sim = await world();
    await sim.runDays(14);
    await agent(sim, negative("бесплатно"));
    await sim.runDays(1);
    await agent(sim, negative("обучение"));
    const [monday] = await entriesOf(sim, "AddNegativeKeywords");

    expect(inverseCommands(monday!)).toEqual([{ type: "RemoveNegativeKeywords", directionId: "b1-d1", phrases: ["бесплатно"] }]);
    const result = await rollback(sim.ctx, { businessId: "b1", entryId: monday?.id ?? "" });
    expect(result.kind).toBe("done");
    expect((await sim.platform.getTrafficSettings([await campaignId(sim)]))[0]?.negativeKeywords).toEqual(["обучение"]);
    expect(await sim.store.userDecisions("b1")).toContainEqual(expect.objectContaining({ objectId: analystDecisionKey("b1-d1", "бесплатно"), commandType: "AddNegativeKeywords" }));

    expect(await agent(sim, negative("бесплатно"))).toMatchObject({ status: "rejected", code: "USER_DECISION" });
  });

  it("shows the difference before a rollback when the phrase was removed in the cabinet", async () => {
    const sim = await world();
    await sim.runDays(14);
    await agent(sim, negative("бесплатно"));
    sim.platform.cabinetEditCampaign(await campaignId(sim), { negativeKeywords: [] });
    const [entry] = await entriesOf(sim, "AddNegativeKeywords");
    expect(await rollback(sim.ctx, { businessId: "b1", entryId: entry?.id ?? "" })).toEqual({
      kind: "state_differs",
      expected: { negativeKeywords: '["бесплатно"]' },
      actual: { negativeKeywords: "[]" },
    });
  });

  it("refuses to remove a phrase that is not there", async () => {
    const sim = await world();
    const result = await sim.executor.execute({
      businessId: "b1",
      command: { type: "RemoveNegativeKeywords", directionId: "b1-d1", phrases: ["бесплатно"] },
      actor: "user",
      reasonCode: "USER_CHANGE",
      explanation: "Вы изменили настройки",
    });
    expect(result).toMatchObject({ status: "rejected", code: "NO_CHANGE" });
  });
});

describe("device adjustments through the executor (add-agent-analyst-stage1)", () => {
  const phones = (percent: number): Command => ({ type: "SetDeviceAdjustment", directionId: "b1-d1", device: "mobile", percent });

  it("clamps a step to 25 points, waits 7 days before the next one, and rolls back to the earlier percent", async () => {
    const sim = await world();
    await sim.runDays(14);
    expect(await agent(sim, phones(-30))).toMatchObject({ status: "clamped", command: { percent: -25 }, message: "урезано: не больше 25 пунктов за шаг" });
    expect((await sim.platform.getTrafficSettings([await campaignId(sim)]))[0]?.deviceAdjustments).toEqual({ mobile: -25, desktop: 0 });
    expect((await sim.store.directions("b1"))[0]?.deviceAdjustedOn).toEqual({ mobile: "2026-10-15", desktop: null });
    expect(await agent(sim, phones(-40))).toMatchObject({ status: "rejected", message: "корректировку этого устройства можно менять не чаще раза в 7 дней" });

    const [entry] = await entriesOf(sim, "SetDeviceAdjustment");
    expect(entry).toMatchObject({ before: { mobileAdjustment: 0 }, after: { mobileAdjustment: -25 } });
    expect(inverseCommands(entry!)).toEqual([{ type: "SetDeviceAdjustment", directionId: "b1-d1", device: "mobile", percent: 0 }]);
    expect((await rollback(sim.ctx, { businessId: "b1", entryId: entry?.id ?? "" })).kind).toBe("done");
    expect((await sim.platform.getTrafficSettings([await campaignId(sim)]))[0]?.deviceAdjustments).toEqual({ mobile: 0, desktop: 0 });

    await sim.runDays(8);
    expect(await agent(sim, phones(-25))).toMatchObject({ status: "rejected", code: "USER_DECISION" });
  });

  it("chains a later change of the same device into a rollback, but not of the other device or the limit", async () => {
    const sim = await world();
    await sim.runDays(14);
    await agent(sim, phones(-20));
    await sim.executor.execute({ businessId: "b1", command: { type: "SetSpendLimit", directionId: "b1-d1", weeklyLimit: rubles(2_500) }, actor: "user", reasonCode: "USER_CHANGE", explanation: "Вы изменили лимит" });
    await sim.runDays(8);
    await agent(sim, { type: "SetDeviceAdjustment", directionId: "b1-d1", device: "desktop", percent: 20 });
    const [first] = await entriesOf(sim, "SetDeviceAdjustment");
    expect((await rollback(sim.ctx, { businessId: "b1", entryId: first?.id ?? "" })).kind).toBe("done");
    expect((await sim.platform.getTrafficSettings([await campaignId(sim)]))[0]?.deviceAdjustments).toEqual({ mobile: 0, desktop: 20 });

    // A second change of phones joins the rollback of the first one.
    await sim.runDays(15);
    await agent(sim, phones(-20));
    await sim.runDays(8);
    await agent(sim, phones(-40));
    const phoneEntries = (await entriesOf(sim, "SetDeviceAdjustment")).filter((c) => c.action.type === "SetDeviceAdjustment" && c.action.device === "mobile" && c.revertedById === null);
    expect(phoneEntries).toHaveLength(2);
    const ask = await rollback(sim.ctx, { businessId: "b1", entryId: phoneEntries[0]?.id ?? "" });
    expect(ask.kind === "needs_chain" ? ask.later.map((c) => c.id) : []).toEqual([phoneEntries[1]?.id]);
  });

  it("finds an adjustment changed in the cabinet and checks the next command against it", async () => {
    const sim = await world();
    await sim.runDays(14);
    await agent(sim, phones(-25));
    sim.platform.cabinetEditCampaign(await campaignId(sim), { deviceAdjustments: { mobile: 0, desktop: 0 } });

    await reconcileCabinet(sim);
    expect((await sim.store.changes("b1")).filter((c) => c.author === "cabinet").at(-1)).toMatchObject({
      author: "cabinet",
      before: { mobileAdjustment: -25 },
      after: { mobileAdjustment: 0 },
      explanation: "Изменено в кабинете Директа: цена перехода по устройствам направления «Маникюр — Поиск».",
    });
    expect((await sim.store.directions("b1"))[0]?.deviceAdjustments).toEqual({ mobile: 0, desktop: 0 });
  });

  it("takes the settings of a direction launched before they were kept without a history entry", async () => {
    const sim = await world();
    sim.platform.cabinetEditCampaign(await campaignId(sim), { negativeKeywords: ["вакансии"] });
    await reconcile(sim.ctx, "b1");
    expect((await sim.store.directions("b1"))[0]?.negativeKeywords).toEqual(["вакансии"]);
    expect((await sim.store.changes("b1")).filter((c) => c.author === "cabinet")).toHaveLength(0);
  });
});
