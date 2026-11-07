import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { resolveCso, rubles } from "@impuls/core";
import { expect } from "vitest";
import {
  budgetTooLowMessage,
  emptyDraft,
  goalExplanation,
  goalSource,
  hoursWords,
  normalizeLink,
  OnboardingDraftSchema,
  STEP_COUNT,
  stepIssues,
  wizardStepOf,
  withNormalizedLinks,
} from "../../../apps/web/src/lib/onboarding";
import type { OnboardingDraft } from "../../../apps/web/src/lib/onboarding";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("business-onboarding/wizard.feature"), { language: "ru" });

/** The draft with a service, a city and the budget: everything else on the card step is optional. */
const cardStep = (patch: Partial<OnboardingDraft["card"]> = {}): OnboardingDraft => {
  const draft = emptyDraft();
  return {
    ...draft,
    card: { ...draft.card, services: [{ name: "Маникюр с покрытием", priceRub: null }], city: "Казань", ...patch },
    budget: { ...draft.budget, monthlyBudgetRub: 15_000 },
  };
};

const plain = (text: string): string => text.replace(/[  ]/g, " ");

const messages = (step: number, draft: OnboardingDraft): string[] => stepIssues(step, draft).map((issue) => issue.message);

describeFeature(feature, ({ Scenario }) => {
  let draft: OnboardingDraft;
  let blocked: string[];

  Scenario("Ссылка без https", ({ When, Then }) => {
    When("владелец вводит «nogotok.ru» в поле сайта", () => {
      const empty = emptyDraft();
      draft = withNormalizedLinks({ ...empty, sources: { ...empty.sources, siteUrl: "nogotok.ru" } });
    });
    Then("поле сайта сохраняет «https://nogotok.ru»", () => {
      expect(draft.sources.siteUrl).toBe("https://nogotok.ru");
    });
  });

  Scenario("Сообщество ВКонтакте по названию", ({ When, Then }) => {
    When("владелец вводит «@nogotok» в поле ВКонтакте", () => {
      const empty = emptyDraft();
      draft = withNormalizedLinks({ ...empty, sources: { ...empty.sources, vkUrl: "@nogotok" } });
    });
    Then("сохранена ссылка «https://vk.com/nogotok»", () => {
      expect(draft.sources.vkUrl).toBe("https://vk.com/nogotok");
    });
  });

  Scenario("Не ссылка на Яндекс Карты", ({ When, Then, And }) => {
    When("владелец вставляет «2gis.ru/moscow» в поле Яндекс Карт и нажимает «Дальше»", () => {
      const empty = emptyDraft();
      const withMaps = { ...empty, sources: { ...empty.sources, siteUrl: "https://nogotok.example", mapsUrl: "2gis.ru/moscow" } };
      draft = withNormalizedLinks(withMaps);
      blocked = messages(1, draft);
    });
    Then("шаг 1 не пропускает дальше", () => {
      expect(blocked.length).toBeGreaterThan(0);
    });
    And("под полем Карт написано «Это не ссылка на Яндекс Карты — скопируйте её из адресной строки карточки организации»", () => {
      expect(blocked).toContain("Это не ссылка на Яндекс Карты — скопируйте её из адресной строки карточки организации");
      expect(normalizeLink("maps", "2gis.ru/moscow")).toBeNull();
    });
  });

  Scenario("Нет своего сайта", ({ When, Then }) => {
    When("владелец указывает только ссылку на Яндекс Карты", () => {
      const empty = emptyDraft();
      draft = withNormalizedLinks({ ...empty, sources: { ...empty.sources, mapsUrl: "yandex.ru/maps/org/nogotok/123" } });
      blocked = messages(1, draft);
    });
    Then("шаг 1 просит «Укажите адрес вашего сайта — на него будет вести реклама»", () => {
      expect(blocked).toContain("Укажите адрес вашего сайта — на него будет вести реклама");
    });
  });

  Scenario("Бизнес без адреса", ({ Given, When, Then, And }) => {
    Given("мастер маникюра на выезде указывает услугу «Маникюр с покрытием» и город «Казань»", () => {
      draft = cardStep();
    });
    When("он оставляет адрес, название и вид деятельности пустыми и нажимает «Дальше»", () => {
      blocked = messages(2, draft);
    });
    Then("шаг 2 пропускает дальше", () => {
      expect(blocked).toEqual([]);
    });
    And("реклама создаётся для города «Казань»", () => {
      expect(draft.card.city).toBe("Казань");
      expect(draft.card.address).toBe("");
    });
  });

  Scenario("Город не определён", ({ Given, When, Then }) => {
    Given("в источниках нет адреса и город не заполнен", () => {
      draft = cardStep({ city: "" });
    });
    When("владелец нажимает «Дальше» на шаге 2", () => {
      blocked = messages(2, draft);
    });
    Then("шаг 2 просит «Укажите город — в нём будет показываться реклама»", () => {
      expect(blocked).toContain("Укажите город — в нём будет показываться реклама");
    });
  });

  Scenario("Работа после полуночи", ({ When, Then, And }) => {
    When("бар указывает часы «Пн–Вс с 22:00 до 02:00»", () => {
      draft = cardStep({ openFrom: "22:00", openTo: "02:00" });
    });
    Then("система принимает часы", () => {
      expect(messages(2, draft)).toEqual([]);
    });
    And("пишет «Пн–Вс 22:00–02:00 (через полночь)»", () => {
      expect(hoursWords(draft.card)).toBe("Пн–Вс 22:00–02:00 (через полночь)");
    });
  });

  Scenario("Цель подобрана автоматически", ({ When, Then, And }) => {
    When("владелец салона вводит бюджет 15 000 ₽, не трогая выбор цены обращения", () => {
      draft = cardStep();
    });
    Then("выбрано «Подбирайте сами», и шаг 2 пропускает дальше, не показывая стартовую цену обращения", () => {
      expect(draft.budget.goalMode).toBe("auto");
      expect(messages(2, draft)).toEqual([]);
      // The hidden reference (15 000 ₽ / 30 = 500 ₽) is not in the words under the choice.
      expect(goalExplanation(draft.budget)).not.toMatch(/\d/);
    });
    And("после запуска цель подбирается автоматически", () => {
      expect(goalSource(draft)).toEqual({ kind: "auto", reference: rubles(500) });
    });
  });

  Scenario("Своя цель в мастере", ({ When, Then, And }) => {
    When("владелец вводит бюджет 15 000 ₽, выбирает «Укажу сумму» и указывает 500 ₽", () => {
      const base = cardStep();
      draft = { ...base, budget: { ...base.budget, goalMode: "user", goalRub: 500 } };
      expect(messages(2, draft)).toEqual([]);
    });
    Then("пояснение под выбором говорит, что реклама с обращениями дороже 500 ₽ отключается", () => {
      expect(plain(goalExplanation(draft.budget))).toBe("Будем отключать рекламу, которая приводит обращения дороже 500 ₽, и добавлять денег той, что дешевле.");
    });
    And("после запуска цель — своя, 500 ₽, и автоматически не пересчитывается", () => {
      const source = goalSource(draft);
      expect(source).toEqual({ kind: "user", goal: rubles(500) });
      expect(resolveCso(source, { leads: 25, medianCostPerLead: rubles(380) })).toBe(rubles(500));
    });
  });

  Scenario("Своя сумма не указана", ({ When, Then }) => {
    When("владелец выбирает «Укажу сумму», оставляет поле пустым и нажимает «Дальше»", () => {
      const base = cardStep();
      draft = { ...base, budget: { ...base.budget, goalMode: "user", goalRub: null } };
    });
    Then("шаг 2 не пропускает дальше, а под полем цены обращения написано «Укажите сумму или выберите «Подбирайте сами»»", () => {
      expect(stepIssues(2, draft)).toEqual([{ field: "goal", message: "Укажите сумму или выберите «Подбирайте сами»" }]);
    });
  });

  Scenario("Мастер без выбора цены", ({ Given, When, Then }) => {
    let stored: unknown;
    Given("владелец начал мастер до этого изменения и сохранил карточку с бюджетом 15 000 ₽", () => {
      // A draft saved before the goal: the budget has the amount only.
      stored = { ...cardStep(), budget: { monthlyBudgetRub: 15_000 } };
    });
    When("он возвращается к шагу «Вот как мы вас поняли»", () => {
      draft = OnboardingDraftSchema.parse(stored);
    });
    Then("выбрано «Подбирайте сами», а бюджет и карточка сохранены", () => {
      expect(draft.budget).toEqual({ monthlyBudgetRub: 15_000, goalMode: "auto", goalRub: null });
      expect(draft.card.services).toEqual([{ name: "Маникюр с покрытием", priceRub: null }]);
      expect(wizardStepOf(2, draft)).toBe(2);
      expect(messages(2, draft)).toEqual([]);
    });
  });

  Scenario("Бюджет ниже минимума", ({ When, Then }) => {
    When("владелец на шаге 2 вводит бюджет 2 000 ₽ и нажимает «Дальше»", () => {
      const base = cardStep();
      blocked = messages(2, { ...base, budget: { ...base.budget, monthlyBudgetRub: 2_000 } });
    });
    Then("шаг 2 не пропускает дальше и объясняет, что минимальный бюджет — 3 000 ₽", () => {
      expect(blocked).toEqual([budgetTooLowMessage]);
    });
  });

  Scenario("Мастер прежнего формата", ({ Given, When, Then }) => {
    let step = 0;
    Given("владелец начал мастер до обновления и остановился на шаге «Бюджет» из шести", () => {
      draft = cardStep();
    });
    When("он снова открывает мастер", () => {
      // The six-step wizard saved 4 for «Бюджет»; no ads were written yet.
      step = wizardStepOf(4, draft);
    });
    Then("открывается шаг 2 из 3 с его карточкой и бюджетом", () => {
      expect(step).toBe(2);
      expect(STEP_COUNT).toBe(3);
      expect(draft.budget.monthlyBudgetRub).toBe(15_000);
    });
  });
});
