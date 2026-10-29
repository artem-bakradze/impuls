import { checkAd, LlmCreativeEngine, ScriptedLlmClient } from "@impuls/agent";
import type { AdDraft, CardFacts, Creatives, HypothesisVariant } from "@impuls/agent";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("ad-creatives/generation.feature"), { language: "ru" });

const salon: CardFacts = {
  name: "Ноготок",
  category: "Маникюрный салон",
  services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }],
  address: "Москва, м. Профсоюзная, 1",
  city: "Москва",
  days: "Пн–Вс",
  openFrom: "10:00",
  openTo: "22:00",
  advantages: [],
};

const ad = (title: string, text: string) => ({ title, text, approach: "price" as const });
const honest = [
  ad("Маникюр с покрытием за 1 800 ₽", "У м. Профсоюзная, работаем до 22:00"),
  ad("Маникюр у м. Профсоюзная", "Работаем каждый день до 22:00"),
];
const generation = (third: { title: string; text: string; approach: "price" }) => ({
  search: [...honest, third],
  network: [],
  keywords: ["маникюр профсоюзная"],
  negativeKeywords: [],
});
const rewritten = { ads: [{ title: "Маникюр с покрытием у метро", text: "Маникюр с покрытием за 1 800 ₽, м. Профсоюзная" }] };

describeFeature(feature, ({ Scenario }) => {
  Scenario("Объявления для маникюрного салона", ({ Given, When, Then, And }) => {
    let result: Creatives;
    Given("карточка салона: «маникюр с покрытием — 1 800 ₽», м. Профсоюзная, работа до 22:00", () => {
      expect(salon.services[0]?.priceRub).toBe(1_800);
    });
    When("сервис пишет объявления, а модель в одном из них указывает цену 1 500 ₽", async () => {
      const llm = new ScriptedLlmClient({ generate_creatives: [generation(ad("Маникюр за 1 500 ₽", "У м. Профсоюзная"))], rewrite_ads: [rewritten] });
      result = await new LlmCreativeEngine(llm).generate(salon, { search: true, network: false });
    });
    Then("все объявления используют факты карточки", () => {
      expect(result.search).toHaveLength(3);
      expect(result.search.every((a) => checkAd(a, salon).length === 0)).toBe(true);
    });
    And("ни одно объявление не содержит цены 1 500 ₽", () => {
      expect(result.search.some((a) => /1[\s  ]?500/.test(`${a.title} ${a.text}`))).toBe(false);
    });
  });

  Scenario("Сгенерирован текст с «лучший»", ({ Given, When, Then, And }) => {
    let drafts: AdDraft[] = [];
    Given("карточка салона: «маникюр с покрытием — 1 800 ₽», м. Профсоюзная, работа до 22:00", () => {
      expect(salon.openTo).toBe("22:00");
    });
    When("модель вернула объявление «Лучший маникюр в районе»", async () => {
      const llm = new ScriptedLlmClient({ generate_creatives: [generation(ad("Лучший маникюр в районе", "У м. Профсоюзная, до 22:00"))], rewrite_ads: [rewritten] });
      drafts = (await new LlmCreativeEngine(llm).generate(salon, { search: true, network: false })).search;
    });
    Then("это объявление не попадает в черновик", () => {
      expect(drafts.map((a) => a.title)).not.toContain("Лучший маникюр в районе");
    });
    And("вместо него в черновике вариант без превосходной степени", () => {
      expect(drafts).toHaveLength(3);
      expect(drafts.flatMap((a) => checkAd(a, salon)).filter((i) => i.code === "SUPERLATIVE")).toEqual([]);
    });
  });

  Scenario("Гипотеза для объявления с пограничной эффективностью", ({ Given, When, Then, And }) => {
    const original = { title: "Маникюр 1 800 ₽ у метро", text: "У м. Профсоюзная, работаем до 22:00" };
    let variant: HypothesisVariant;
    Given("карточка салона: «маникюр с покрытием — 1 800 ₽», м. Профсоюзная, работа до 22:00", () => {
      expect(salon.address).toContain("Профсоюзная");
    });
    When("агент запрашивает вариант для объявления «Маникюр 1 800 ₽ у метро» с другим предложением", async () => {
      const llm = new ScriptedLlmClient({
        hypothesis_variant: [{ title: "Совсем другой заголовок", text: "Маникюр с покрытием за 1 800 ₽ рядом с метро", hypothesis: "Проверяем, приведёт ли цена в тексте больше записей" }],
      });
      variant = await new LlmCreativeEngine(llm).variant(salon, original, "offer");
    });
    Then("вариант отличается от объявления только текстом", () => {
      expect(variant.title).toBe(original.title);
      expect(variant.text).not.toBe(original.text);
      expect(variant.changed).toBe("text");
    });
    And("гипотеза сформулирована простым языком и начинается со слова «Проверяем»", () => {
      expect(variant.hypothesis).toMatch(/^Проверяем, /);
    });
  });
});
