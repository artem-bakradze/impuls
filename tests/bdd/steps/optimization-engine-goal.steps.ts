import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { resolveCso, rubles } from "@impuls/core";
import type { CsoSource, Kopecks } from "@impuls/core";
import { expect } from "vitest";
import { emptyDraft, goalSource } from "../../../apps/web/src/lib/onboarding";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("optimization-engine/goal.feature"), { language: "ru" });

describeFeature(feature, ({ Scenario }) => {
  Scenario("Своя цель из мастера", ({ Given, When, Then }) => {
    let source: CsoSource;
    let cso: Kopecks;
    Given("владелец указал в мастере цель 500 ₽ и запустил рекламу", () => {
      // The wizard saves the goal it chose with the budget; the launch reads it as is (target-on-budget-step design 2).
      const draft = emptyDraft();
      draft.budget = { monthlyBudgetRub: 15_000, goalMode: "user", goalRub: 500 };
      source = goalSource(draft);
    });
    When("за 30 дней пришло 25 обращений, а медиана их стоимости — 380 ₽", () => {
      cso = resolveCso(source, { leads: 25, medianCostPerLead: rubles(380) });
    });
    Then("цель остаётся 500 ₽, и автоматического пересчёта нет", () => {
      expect(source).toEqual({ kind: "user", goal: rubles(500) });
      expect(cso).toBe(rubles(500));
      // The same numbers recalculate a goal of «Подбирайте сами»: the median is below the cap of 1.5 × the reference.
      expect(resolveCso({ kind: "auto", reference: rubles(500) }, { leads: 25, medianCostPerLead: rubles(380) })).toBe(rubles(380));
    });
  });
});
