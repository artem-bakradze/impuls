import type { ToolResult } from "@impuls/agent";
import { factKey } from "@impuls/core";
import type { Command } from "@impuls/core";
import { rollback } from "@impuls/worker";
import type { RollbackResult, SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { agentEntries, agentTurn, factOf, rowOf, salon, trafficOf } from "./analyst-world";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("change-history/analyst-rollback.feature"), { language: "ru" });

/** The agent's action in a turn, with an insight on the breakdown's facts of the given row. */
const act = async (sim: SimulationDriver, command: Command, dimension: "query" | "device", segment: string): Promise<ToolResult | null> => {
  let result: ToolResult | null = null;
  await agentTurn(sim, async (tools) => {
    const row = rowOf(await tools.breakdown("b1-d1", dimension), segment);
    result = await tools.act(command, {
      reasonCode: "AGENT_ANALYST",
      observation: "Этот сегмент приводит клиентов дороже цели.",
      factKeys: [factOf(row, "spend"), factOf(row, "leads"), factKey.goal()],
      next: "Через неделю проверим цену обращения.",
    });
  });
  return result;
};

describeFeature(feature, ({ Scenario }) => {
  Scenario("Откат одной минус-фразы", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let outcome: RollbackResult;
    Given("агент в один день добавил минус-фразу «бесплатно», а на следующий — «обучение»", async () => {
      sim = await salon();
      expect(await act(sim, { type: "AddNegativeKeywords", directionId: "b1-d1", phrases: ["бесплатно"] }, "query", "маникюр бесплатно")).toMatchObject({ status: "applied" });
      await sim.runDays(1);
      expect(await act(sim, { type: "AddNegativeKeywords", directionId: "b1-d1", phrases: ["обучение"] }, "query", "маникюр обучение")).toMatchObject({ status: "applied" });
    });
    When("владелец возвращает запись с «бесплатно»", async () => {
      const [first] = await agentEntries(sim, "AddNegativeKeywords");
      outcome = await rollback(sim.ctx, { businessId: "b1", entryId: first?.id ?? "" });
    });
    Then("у рекламы остаётся минус-фраза «обучение», а «бесплатно» убрана", async () => {
      expect(outcome.kind).toBe("done");
      expect((await trafficOf(sim)).negativeKeywords).toEqual(["обучение"]);
    });
    And("в истории есть запись отката", async () => {
      const last = (await sim.store.changes("b1")).at(-1);
      expect(last).toMatchObject({ actor: "user", reasonCode: "USER_ROLLBACK", action: { type: "RemoveNegativeKeywords", phrases: ["бесплатно"] } });
    });
  });

  Scenario("Откат корректировки", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    Given("агент снизил цену перехода с телефонов с 0% до −25%", async () => {
      sim = await salon();
      expect(await act(sim, { type: "SetDeviceAdjustment", directionId: "b1-d1", device: "mobile", percent: -25 }, "device", "телефоны")).toMatchObject({ status: "applied" });
    });
    When("владелец возвращает эту запись", async () => {
      const [entry] = await agentEntries(sim, "SetDeviceAdjustment");
      expect((await rollback(sim.ctx, { businessId: "b1", entryId: entry?.id ?? "" })).kind).toBe("done");
    });
    Then("корректировка для телефонов снова 0%", async () => {
      expect((await trafficOf(sim)).deviceAdjustments.mobile).toBe(0);
    });
    And("агент 14 дней не меняет её сам", async () => {
      await sim.runDays(8);
      expect(await act(sim, { type: "SetDeviceAdjustment", directionId: "b1-d1", device: "mobile", percent: -25 }, "device", "телефоны")).toMatchObject({ status: "rejected", code: "USER_DECISION" });
    });
  });
});
