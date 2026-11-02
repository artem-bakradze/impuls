import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { emptyDraft, hoursWords, normalizeLink, stepIssues, withNormalizedLinks } from "../../../apps/web/src/lib/onboarding";
import type { OnboardingDraft } from "../../../apps/web/src/lib/onboarding";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("business-onboarding/wizard.feature"), { language: "ru" });

/** The draft with a service and a city: everything else on the card step is optional. */
const cardStep = (patch: Partial<OnboardingDraft["card"]> = {}): OnboardingDraft => {
  const draft = emptyDraft();
  return {
    ...draft,
    card: { ...draft.card, services: [{ name: "Маникюр с покрытием", priceRub: null }], city: "Казань", ...patch },
  };
};

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
    When("владелец салона вводит бюджет 15 000 ₽", () => {
      draft = { ...cardStep(), budget: { monthlyBudgetRub: 15_000 } };
    });
    Then("шаг 4 не спрашивает цену обращения", () => {
      expect(messages(4, draft)).toEqual([]);
    });
    And("в черновике только бюджет месяца", () => {
      expect(Object.keys(draft.budget)).toEqual(["monthlyBudgetRub"]);
    });
  });
});
