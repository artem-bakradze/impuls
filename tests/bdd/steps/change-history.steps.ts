import { rubles } from "@impuls/core";
import { BUDGET_ADJUSTMENT_REASON, isBudgetAdjustment, rollback } from "@impuls/worker";
import type { RollbackResult, SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { describeDiff, foldBudgetAdjustments, newestFirst, objectName } from "../../../apps/web/src/lib/history-view";
import type { HistoryItem, Names } from "../../../apps/web/src/lib/history-view";
import { featurePath, launchedWorld } from "./world";

/** A budget-guard cut of the first direction's limit, as the hourly guard logs it. */
const budgetCut = async (sim: SimulationDriver, rub: number) => {
  await sim.executor.execute({
    businessId: "b1",
    command: { type: "SetSpendLimit", directionId: "b1-d1", weeklyLimit: rubles(rub) },
    actor: "budget_guard",
    reasonCode: "BUDGET_FIT",
    explanation: `Снизил лимит направления «Маникюр — Поиск» до ${rub} ₽ в неделю, чтобы не выйти за ваш бюджет на месяц.`,
  });
};

/** The history feed as the history screen builds it (apps/web lib/server/history), without the web runtime. */
const historyFeed = async (sim: SimulationDriver) => {
  const directions = await sim.store.directions("b1");
  const names: Names = {
    directions: Object.fromEntries(directions.map((d) => [d.id, d.name])),
    channels: Object.fromEntries(directions.map((d) => [d.id, d.channel])),
    ads: {},
    strategies: {},
  };
  const items = (await sim.store.changes("b1")).map(
    (entry): HistoryItem => ({
      id: entry.id,
      at: entry.createdAt.toISOString(),
      author: entry.author,
      object: objectName(entry.objectKind, entry.objectId, names),
      diff: describeDiff(entry.before, entry.after, names),
      explanation: entry.explanation,
      outcome: entry.outcome,
      turnId: entry.turnId,
      insight: null,
      status: entry.status,
      reverted: entry.revertedById !== null,
      rollback: { kind: "available", consequences: [] },
      budgetAdjustment: isBudgetAdjustment(entry),
    }),
  );
  return foldBudgetAdjustments(newestFirst(items), "Europe/Moscow");
};

const feature = await loadFeature(featurePath("change-history/rollback.feature"), { language: "ru" });

describeFeature(feature, ({ Scenario }) => {
  Scenario("Откат паузы", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let entryId = "";
    let adId = "";
    Given("сервис отключил объявление без обращений страховочным правилом", async () => {
      sim = await launchedWorld(30_000);
      await sim.runDays(14);
      const entry = (await sim.store.changes("b1")).find((c) => c.reasonCode === "SAFETY_PAUSE_AD");
      entryId = entry?.id ?? "";
      adId = entry?.objectId ?? "";
      expect(entryId).not.toBe("");
    });
    When("пользователь нажимает «Вернуть как было» у этой записи", async () => {
      expect((await rollback(sim.ctx, { businessId: "b1", entryId })).kind).toBe("done");
    });
    Then("объявление снова активно", async () => {
      expect((await sim.store.ads("b1")).find((a) => a.id === adId)?.status).toBe("active");
    });
    And("исходная запись помечена отменённой, а в истории появилась запись об отмене", async () => {
      const changes = await sim.store.changes("b1");
      expect(changes.find((c) => c.id === entryId)?.revertedById).not.toBeNull();
      expect(changes.some((c) => c.reasonCode === "USER_ROLLBACK" && c.author === "user")).toBe(true);
    });
    And("через 3 дня сервис не отключает это объявление снова", async () => {
      await sim.runDays(3);
      expect((await sim.store.ads("b1")).find((a) => a.id === adId)?.status).toBe("active");
    });
  });

  Scenario("После изменения были более поздние изменения того же объекта", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let firstId = "";
    let result: RollbackResult | null = null;
    Given("пользователь дважды поменял лимит одного направления", async () => {
      sim = await launchedWorld(30_000);
      for (const rub of [1_500, 1_000]) {
        await sim.executor.execute({
          businessId: "b1",
          command: { type: "SetSpendLimit", directionId: "b1-d1", weeklyLimit: rubles(rub) },
          actor: "user",
          reasonCode: "USER_LIMIT",
          explanation: "Вы изменили лимит",
        });
      }
      firstId = (await sim.store.changes("b1"))[0]?.id ?? "";
    });
    When("он откатывает первое изменение", async () => {
      result = await rollback(sim.ctx, { businessId: "b1", entryId: firstId });
    });
    Then("сервис показывает более позднее изменение и предлагает откатить их вместе", () => {
      expect(result?.kind).toBe("needs_chain");
    });
    And("после согласия лимит возвращается к исходному", async () => {
      expect((await rollback(sim.ctx, { businessId: "b1", entryId: firstId, includeLater: true })).kind).toBe("done");
      expect((await sim.store.directions("b1")).find((d) => d.id === "b1-d1")?.weeklyLimit).toBe(rubles(2_000));
    });
  });

  Scenario("Необратимое изменение", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let result: RollbackResult | null = null;
    Given("сервис запустил проверку объявления", async () => {
      sim = await launchedWorld(30_000);
      await sim.executor.execute({
        businessId: "b1",
        command: {
          type: "StartExperiment",
          directionId: "b1-d1",
          adId: "b1-d1-a1",
          kind: "offer",
          hypothesis: "Проверяем оффер",
          variant: { title: "Маникюр у метро", text: "Первый визит −15%" },
        },
        actor: "safety_net",
        reasonCode: "SAFETY_START_EXPERIMENT",
        explanation: "Запустил проверку",
      });
    });
    When("пользователь пытается откатить запуск проверки", async () => {
      result = await rollback(sim.ctx, { businessId: "b1", entryId: (await sim.store.changes("b1"))[0]?.id ?? "" });
    });
    Then("отката нет, и сервис объясняет почему", () => {
      expect(result).toMatchObject({ kind: "not_reversible" });
      expect(result?.kind === "not_reversible" ? result.reason : "").toContain("проверку нельзя отменить");
    });
  });

  Scenario("Подстройка лимита защитой бюджета", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let result: RollbackResult | null = null;
    Given("защита бюджета снизила лимит рекламы под остаток месяца", async () => {
      sim = await launchedWorld(30_000);
      await budgetCut(sim, 1_900);
    });
    When("пользователь пытается откатить эту подстройку", async () => {
      result = await rollback(sim.ctx, { businessId: "b1", entryId: (await sim.store.changes("b1")).at(-1)?.id ?? "" });
    });
    Then("отката нет, а подпись говорит, что лимит пересчитывается сам по остатку бюджета", async () => {
      expect(result).toEqual({ kind: "not_reversible", reason: BUDGET_ADJUSTMENT_REASON });
      expect(BUDGET_ADJUSTMENT_REASON).toMatch(/^лимит пересчитывается сам по остатку бюджета/);
      expect((await sim.store.directions("b1"))[0]?.weeklyLimit).toBe(rubles(1_900));
    });
  });

  Scenario("Подстройки лимитов за день", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let feed: Awaited<ReturnType<typeof historyFeed>> = [];
    Given("за день защита бюджета 3 раза снизила лимит рекламы в поиске", async () => {
      sim = await launchedWorld(30_000);
      sim.clock.set(new Date("2026-10-02T07:00:00Z"));
      for (const rub of [1_950, 1_900, 1_850]) {
        await budgetCut(sim, rub);
        sim.clock.set(new Date(sim.clock.now().getTime() + 3_600_000));
      }
    });
    When("пользователь открывает историю", async () => {
      feed = await historyFeed(sim);
    });
    Then("он видит одну строку «Защита бюджета» с тем, как лимит изменился за день, и все 3 записи по нажатию", () => {
      const days = feed.filter((row) => row.kind === "budget");
      expect(days).toHaveLength(1);
      const group = days[0]?.kind === "budget" ? days[0].group : null;
      expect(group?.entries).toHaveLength(3);
      expect(group?.limits.map((l) => `${l.object}: ${l.from} → ${l.to}`.replace(/[\u00a0\u202f]/g, " "))).toEqual(["Реклама в поиске: 2 000 ₽ в неделю → 1 850 ₽ в неделю"]);
      expect(feed.some((row) => row.kind === "entry" && row.item.budgetAdjustment)).toBe(false);
    });
  });
});
