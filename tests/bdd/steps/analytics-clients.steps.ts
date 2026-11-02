import { ClientConfirmationError, confirmClients, weeklyClientCost } from "@impuls/worker";
import type { ClientCost, SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath, launchedWorld } from "./world";

const feature = await loadFeature(featurePath("analytics/clients.feature"), { language: "ru" });

const WEEK = "2026-10-05";
const SPEND = 600_000;
const MESSAGE = "Клиентов не может быть больше, чем обращений — за эту неделю их 12";

describeFeature(feature, ({ Scenario }) => {
  let sim: SimulationDriver;
  let cost: ClientCost | null = null;
  let error: unknown = null;

  const seedWeek = async (): Promise<void> => {
    sim = await launchedWorld(30_000);
    const [direction] = await sim.store.directions("b1");
    const campaignId = direction?.platformCampaignId ?? "";
    await sim.store.upsertStats("b1", [
      { campaignId, date: WEEK, impressions: 1_000, clicks: 100, leads: 7, spend: 350_000 },
      { campaignId, date: "2026-10-06", impressions: 1_000, clicks: 100, leads: 5, spend: 250_000 },
    ]);
  };

  const answer = async (clients: number): Promise<void> => {
    try {
      await confirmClients(sim.ctx, "b1", WEEK, clients);
      cost = await weeklyClientCost(sim.ctx, "b1", WEEK);
    } catch (caught) {
      error = caught;
    }
  };

  Scenario("Пользователь ответил", ({ Given, When, Then }) => {
    Given("за неделю было 12 обращений и потрачено 6 000 ₽", seedWeek);
    When("владелец отвечает, что клиентами стали 4 обращения", () => answer(4));
    Then("стоимость клиента — 1 500 ₽", () => {
      expect(error).toBeNull();
      expect(cost).toEqual({ kind: "known", spend: SPEND, clients: 4, costPerClient: 150_000 });
    });
  });

  Scenario("Ответ больше числа обращений", ({ Given, When, Then }) => {
    Given("за неделю было 12 обращений и потрачено 6 000 ₽", seedWeek);
    When("владелец отвечает, что клиентами стали 15 обращений", () => answer(15));
    Then("ответ не принимается с сообщением «Клиентов не может быть больше, чем обращений — за эту неделю их 12»", async () => {
      expect(error).toBeInstanceOf(ClientConfirmationError);
      expect((error as Error).message).toBe(MESSAGE);
      expect((await sim.store.clientConfirmations("b1"))).toEqual([]);
    });
  });
});
