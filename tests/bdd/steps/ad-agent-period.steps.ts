import { HeuristicPolicy } from "@impuls/agent";
import type { TurnResult, TurnTrigger } from "@impuls/agent";
import { handleWebJob, RULES_DAY_CODE } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { GOOD, ownerWorld } from "./owner-world";
import type { OwnerWorld } from "./owner-world";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("ad-agent/period-review.feature"), { language: "ru" });

/** The deterministic agent, with the trigger of every turn kept for the checks. */
class TriggerLog extends HeuristicPolicy {
  readonly triggers: TurnTrigger[] = [];
  override runTurn(input: Parameters<HeuristicPolicy["runTurn"]>[0]): Promise<TurnResult> {
    if (input.trigger) this.triggers.push(input.trigger);
    return super.runTurn(input);
  }
}

describeFeature(feature, ({ Scenario }) => {
  Scenario("Разбор после любого периода", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    const agent = new TriggerLog();
    Given("реклама запущена в симуляции с тестовой политикой агента", async () => {
      w = await ownerWorld(agent);
      // The launch's own review goes with the first period; this scenario is about a later one.
      await w.enter(1);
      agent.triggers.length = 0;
    });
    When("владелец вносит статистику за 3 дня, и у оценки нет поводов", async () => {
      await w.enter(3);
      expect((await w.store.lastEvaluation("b1"))?.findings ?? []).toEqual([]);
    });
    Then("выполняется один ход агента с периодом из 3 дней, и появляется его разбор", async () => {
      expect(agent.triggers).toEqual([{ kind: "period_review", from: "2026-11-02", to: "2026-11-04", reasons: [], events: [] }]);
      const turn = (await w.store.turns("b1")).at(-1);
      expect(turn).toMatchObject({ trigger: "period_review", status: "completed" });
      expect(turn?.summary).toBeTruthy();
    });
  });

  Scenario("Две недели — один ход", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("реклама запущена в симуляции с тестовой политикой агента", async () => {
      w = await ownerWorld(new TriggerLog());
    });
    When("владелец вносит статистику за 2 недели, в которые входит понедельник", async () => {
      await w.enter(14, { [GOOD]: { impressions: 2_000, clicks: 80, leads: 6, spendRub: 900 } });
    });
    Then("за период выполняется один ход агента, без ежедневных разборов и без разбора недели", async () => {
      expect((await w.store.turns("b1")).map((t) => t.trigger)).toEqual(["period_review"]);
    });
  });

  Scenario("Изменение владельца между периодами", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    const agent = new TriggerLog();
    Given("реклама запущена в симуляции с тестовой политикой агента, и владелец внёс первый период", async () => {
      w = await ownerWorld(agent);
      await w.week();
    });
    When("владелец между периодами меняет время показа рекламы и вносит следующий период", async () => {
      const direction = (await w.store.directions("b1"))[0];
      await handleWebJob(w.ctx, { kind: "command", businessId: "b1", command: { type: "UpdateSchedule", directionId: direction?.id ?? "", schedule: "Пн–Вс 10:00–21:00" }, explanation: "Вы изменили время показа." });
      expect((await w.store.turns("b1")).length).toBe(1);
      await w.week();
    });
    Then("отдельного хода по изменению нет, а ход следующего периода получает его вместе с поводами оценки", async () => {
      expect((await w.store.turns("b1")).map((t) => t.trigger)).toEqual(["period_review", "period_review"]);
      const last = agent.triggers.at(-1);
      expect(last).toMatchObject({ kind: "period_review", from: "2026-11-08", to: "2026-11-14", events: [{ kind: "settings_changed" }] });
      expect(last?.kind === "period_review" ? Array.isArray(last.reasons) : false).toBe(true);
      expect(await w.store.pendingInbox("b1")).toEqual([]);
    });
  });

  Scenario("Агент выключен", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("реклама запущена в симуляции, а агент у бизнеса выключен", async () => {
      w = await ownerWorld(new TriggerLog());
      await w.store.setFlag("agent_enabled", false, "b1");
    });
    When("владелец вносит период", async () => {
      await w.week();
    });
    Then("в конце периода решают страховочные правила, модель не вызывается, а разбор говорит «Решения за эти дни принимали страховочные правила: помощник выключен»", async () => {
      expect(await w.store.turns("b1")).toEqual([]);
      const rules = (await w.store.insights("b1")).find((i) => i.reasonCode === RULES_DAY_CODE);
      expect(rules?.observation).toBe("Решения за эти дни принимали страховочные правила: помощник выключен");
      expect((await w.work()).journal.flatMap((s) => s.entries).some((e) => e.kind === "rules" && e.period !== undefined)).toBe(true);
    });
  });

  Scenario("Лимит затрат прогона исчерпан", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("реклама запущена в симуляции, и затраты на модель в прогоне дошли до лимита", async () => {
      w = await ownerWorld(new TriggerLog());
      w.ctx.agentCosts = { inputKopecksPerMTok: 0, outputKopecksPerMTok: 0, monthlyLimitKopecks: 1_000_000, simulationRunLimitKopecks: 0 };
    });
    When("владелец вносит период", async () => {
      await w.week();
    });
    Then("период разбирают страховочные правила, а разбор говорит «Решения за эти дни принимали страховочные правила: лимит расходов на помощника исчерпан»", async () => {
      expect((await w.store.turns("b1")).filter((t) => t.status === "completed")).toEqual([]);
      const rules = (await w.store.insights("b1")).find((i) => i.reasonCode === RULES_DAY_CODE);
      expect(rules?.observation).toBe("Решения за эти дни принимали страховочные правила: лимит расходов на помощника исчерпан");
    });
  });
});
