import { instructionsFor } from "@impuls/agent";
import type { AgentRuntime, AgentToolbox, HypothesisResult, TurnResult, TurnSnapshot } from "@impuls/agent";
import { factKey } from "@impuls/core";
import type { InsightFact } from "@impuls/core";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { speech } from "../../../apps/web/src/lib/service-work";
import { BAD, GOOD, ownerWorld, PARTNER, PLAIN } from "./owner-world";
import type { OwnerWorld } from "./owner-world";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("ad-agent/period-story.feature"), { language: "ru" });

/** Keeps the snapshot of the period's turn. */
class SnapshotAgent implements AgentRuntime {
  readonly name = "policy:snapshot";
  readonly instructionsVersion = "test";
  readonly decides = true;
  facts: InsightFact[] = [];
  adsDays = 0;
  runTurn(input: { snapshot: TurnSnapshot }): Promise<TurnResult> {
    this.facts = input.snapshot.facts;
    this.adsDays = input.snapshot.adsDays;
    return Promise.resolve({ summary: "Посмотрел цифры за эти дни.", calls: [], usage: null });
  }
}

/** Wants three new hypotheses out of one review. */
class ThreeHypothesesAgent implements AgentRuntime {
  readonly name = "policy:three-hypotheses";
  readonly instructionsVersion = "test";
  readonly decides = true;
  results: HypothesisResult[] = [];
  async runTurn(input: { snapshot: TurnSnapshot; tools: AgentToolbox }): Promise<TurnResult> {
    for (const statement of ["Поиску мало дней.", "Объявления в поиске не про то, что ищут.", "Цена перехода в поиске высока."]) {
      this.results.push(await input.tools.saveHypothesis({ statement, factKeys: [factKey.goal(), factKey.budget("budget_left")], check: "Посмотрю через неделю.", checkOn: input.snapshot.today, status: "checking" }));
    }
    return { summary: "Посмотрел цифры и записал, что проверю.", calls: [], usage: null };
  }
}

const value = (facts: readonly InsightFact[], key: string) => facts.find((f) => f.key === key)?.value;

describeFeature(feature, ({ Scenario }) => {
  Scenario("Итог всей рекламы в фактах", ({ Given, When, Then, And }) => {
    const agent = new SnapshotAgent();
    let w: OwnerWorld;
    Given("реклама запущена в симуляции", async () => {
      w = await ownerWorld(agent);
    });
    When("за период вся реклама потратила 1 074 ₽ и принесла 2 обращения: поиск — 645 ₽ без обращений, сайты-партнёры — 429 ₽ и 2 обращения", async () => {
      await w.enter(7, {
        [PLAIN]: { impressions: 73, clicks: 3, leads: 0, spendRub: 188 },
        [GOOD]: { impressions: 78, clicks: 5, leads: 0, spendRub: 237 },
        [BAD]: { impressions: 59, clicks: 4, leads: 0, spendRub: 220 },
        [PARTNER]: { impressions: 3_102, clicks: 18, leads: 2, spendRub: 429 },
      });
    });
    Then("факты разбора периода содержат 1 074 ₽, 2 обращения и 537 ₽ за обращение по всей рекламе за эти дни", () => {
      expect(value(agent.facts, factKey.total("spend"))).toBe(1_074);
      expect(value(agent.facts, factKey.total("leads"))).toBe(2);
      expect(value(agent.facts, factKey.total("cost_per_lead"))).toBe(537);
    });
    And("по поиску — 645 ₽ и 0 обращений, по сайтам-партнёрам — 429 ₽, 2 обращения и 215 ₽ за обращение", () => {
      expect(value(agent.facts, factKey.channel("search", "spend", "period"))).toBe(645);
      expect(value(agent.facts, factKey.channel("search", "leads", "period"))).toBe(0);
      expect(value(agent.facts, factKey.channel("search", "cost_per_lead", "period"))).toBeUndefined();
      expect(value(agent.facts, factKey.channel("network", "spend", "period"))).toBe(429);
      expect(value(agent.facts, factKey.channel("network", "leads", "period"))).toBe(2);
      expect(value(agent.facts, factKey.channel("network", "cost_per_lead", "period"))).toBe(215);
    });
  });

  Scenario("Ярлык в начале убирается", ({ When, Then }) => {
    let shown: string[] = [];
    When("модель написала разбор «Разбор периода: ничего не менял — реклама пока собирает данные.»", () => {
      shown = speech("Разбор периода: ничего не менял — реклама пока собирает данные.");
    });
    Then("владелец видит «Ничего не менял — реклама пока собирает данные.»", () => {
      expect(shown).toEqual(["Ничего не менял — реклама пока собирает данные."]);
    });
  });

  Scenario("Гипотеза после выбора объяснения", ({ Given, When, Then }) => {
    const agent = new ThreeHypothesesAgent();
    let w: OwnerWorld;
    Given("реклама запущена в симуляции с помощником, который хочет записать три гипотезы за разбор", async () => {
      w = await ownerWorld(agent);
    });
    When("владелец вносит период", async () => {
      await w.enter(7, { [PLAIN]: { impressions: 700, clicks: 35, leads: 0, spendRub: 900 } });
    });
    Then("записаны две новые гипотезы, третью сервис не принял с причиной «за этот разбор уже записаны две гипотезы — выбери главную»", async () => {
      expect(agent.results.map((r) => r.status)).toEqual(["applied", "applied", "rejected"]);
      expect(agent.results[2]).toMatchObject({ message: "за этот разбор уже записаны две гипотезы — выбери главную" });
      expect((await w.store.hypotheses("b1")).filter((h) => h.status === "checking")).toHaveLength(2);
    });
  });

  Scenario("Окно в 14 дней называется по дням рекламы", ({ Given, When, Then, And }) => {
    const agent = new SnapshotAgent();
    let w: OwnerWorld;
    Given("реклама запущена в симуляции, и владелец внёс неделю статистики", async () => {
      w = await ownerWorld(agent);
      await w.enter(7, { [PLAIN]: { impressions: 700, clicks: 35, leads: 1, spendRub: 900 } });
    });
    When("владелец вносит ещё один день, и помощник разбирает его", async () => {
      await w.enter(1, { [PLAIN]: { impressions: 100, clicks: 5, leads: 0, spendRub: 130 } });
    });
    Then("помощник знает, что у рекламы 8 дней с цифрами", () => {
      // The morning of day 9 has no numbers yet: the review's window of 14 days holds all 8 days of the ads.
      expect(agent.adsDays).toBe(8);
    });
    And("инструкция разбора велит называть окно в 14 дней «с начала рекламы» и говорить прежде всего об этом дне", () => {
      const { text } = instructionsFor({ kind: "period_review", from: "2026-11-08", to: "2026-11-08" });
      expect(text).toContain("пиши «с начала рекламы», а не «за 14 дней»");
      expect(text).toContain("Говори прежде всего об этих днях");
    });
  });
});
