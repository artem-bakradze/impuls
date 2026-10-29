import { describe, expect, it } from "vitest";
import {
  budgetCeilingText,
  budgetTooLowMessage,
  buildLaunchPlan,
  cardFactsOf,
  cityOf,
  emptyDraft,
  firstIncompleteStep,
  leadsEstimateText,
  mergeExtractedCard,
  startingWeeklyLimits,
  stepProblems,
} from "./onboarding";
import type { OnboardingDraft } from "./onboarding";

const plain = (text: string) => text.replace(/[  ]/g, " ");

const found = {
  name: "Ноготок",
  category: "Студия маникюра",
  services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }],
  address: "Москва, ул. Профсоюзная, 1",
  days: "Пн–Вс" as const,
  openFrom: "10:00",
  openTo: "22:00",
  phone: "+7 495 123-45-67",
  advantages: ["Стерилизация в сухожаре"],
};

const completeDraft = (): OnboardingDraft => {
  const draft = emptyDraft();
  draft.sources.mapsUrl = "https://yandex.ru/maps/org/123";
  draft.sources.siteUrl = "https://nogotok.example/";
  draft.card = {
    ...draft.card,
    name: "Ноготок",
    category: "Маникюр",
    services: [
      { name: "Маникюр с покрытием", priceRub: 1800 },
      { name: "Педикюр", priceRub: null },
    ],
    address: "Москва, ул. Профсоюзная, 1",
    advantages: ["Работаем без выходных"],
  };
  draft.goals = ["call"];
  draft.budget = { monthlyBudgetRub: 15_000, goalMode: "user", goalRub: 300 };
  draft.ads = {
    search: [{ title: "Маникюр с покрытием за 1 800 ₽", text: "У м. Профсоюзная, работаем без выходных" }],
    network: [{ title: "Ноготок — маникюр у метро", text: "Маникюр с покрытием и педикюр" }],
  };
  draft.keywords = { search: ["маникюр с покрытием", "маникюр москва"], negative: ["обучение", "курсы маникюра"] };
  draft.directConnected = true;
  return draft;
};

describe("card extraction", () => {
  it("fills an untouched card with everything found and leaves the rest empty («Не нашли»)", () => {
    const draft = emptyDraft();
    const merged = mergeExtractedCard(draft, { ...found, services: [{ name: "Маникюр с покрытием", priceRub: null }], phone: null });
    expect(merged.card).toMatchObject({
      name: "Ноготок",
      address: "Москва, ул. Профсоюзная, 1",
      openTo: "22:00",
      phone: "",
      services: [{ name: "Маникюр с покрытием", priceRub: null }],
      advantages: ["Стерилизация в сухожаре"],
    });
  });

  it("never overwrites what the owner already typed", () => {
    const draft = emptyDraft();
    draft.card.name = "Мой салон";
    draft.card.services = [{ name: "Педикюр", priceRub: 2_000 }];
    const merged = mergeExtractedCard(draft, found);
    expect(merged.card.name).toBe("Мой салон");
    expect(merged.card.services).toEqual([{ name: "Педикюр", priceRub: 2_000 }]);
    expect(merged.card.category).toBe("Студия маникюра");
    expect(merged.card.openTo).toBe(draft.card.openTo);
  });
});

describe("wizard steps", () => {
  it("keeps «Дальше» disabled without the owner's site, even with a Maps link and a description", () => {
    expect(stepProblems(1, emptyDraft())).toEqual(["Укажите адрес вашего сайта — на него будет вести реклама"]);
    const mapsOnly = emptyDraft();
    mapsOnly.sources.mapsUrl = "https://yandex.ru/maps/org/123";
    mapsOnly.sources.about = "Делаем маникюр у метро";
    expect(stepProblems(1, mapsOnly)).toEqual(["Укажите адрес вашего сайта — на него будет вести реклама"]);
    mapsOnly.sources.siteUrl = "https://nogotok.example/";
    expect(stepProblems(1, mapsOnly)).toEqual([]);
  });

  it("rejects a link without https", () => {
    const draft = emptyDraft();
    draft.sources.siteUrl = "example.ru";
    expect(stepProblems(1, draft).join()).toMatch(/https/);
  });

  it("does not let the budget go below 3 000 ₽ but accepts 5 000 ₽", () => {
    const draft = completeDraft();
    draft.budget.monthlyBudgetRub = 2_000;
    expect(stepProblems(4, draft)).toContain(budgetTooLowMessage);
    draft.budget.monthlyBudgetRub = 5_000;
    expect(stepProblems(4, draft)).toEqual([]);
  });

  it("accepts «Не знаю — подберите сами» without a goal amount", () => {
    const draft = completeDraft();
    draft.budget = { monthlyBudgetRub: 10_000, goalMode: "auto", goalRub: null };
    expect(stepProblems(4, draft)).toEqual([]);
  });

  it("reports the first incomplete step so progress cannot skip ahead", () => {
    const draft = completeDraft();
    expect(firstIncompleteStep(draft)).toBe(7);
    draft.goals = [];
    expect(firstIncompleteStep(draft)).toBe(3);
  });
});

describe("budget texts", () => {
  it("prorates the first month when ads start after the 1st", () => {
    // 4 of 31 days remain in October: floor(15 000 × 4 / 31) = 1 935 ₽.
    expect(plain(budgetCeilingText(15_000, "2026-10-28"))).toBe("В этом месяце — до 1 935 ₽, дальше — 15 000 ₽ в месяц. Больше этой суммы за месяц мы не потратим");
    expect(plain(budgetCeilingText(15_000, "2026-11-01"))).toBe("Больше 15 000 ₽ за месяц мы не потратим");
  });

  it("estimates leads from the budget and the goal", () => {
    expect(plain(leadsEstimateText(15_000, 300))).toContain("до 50 обращений в месяц, если удастся уложиться в цену");
  });
});

describe("ad drafts and the launch plan", () => {
  it("passes only the confirmed card to ad generation", () => {
    expect(cardFactsOf(completeDraft())).toEqual({
      name: "Ноготок",
      category: "Маникюр",
      services: [
        { name: "Маникюр с покрытием", priceRub: 1800 },
        { name: "Педикюр", priceRub: null },
      ],
      address: "Москва, ул. Профсоюзная, 1",
      city: "Москва",
      days: "Пн–Вс",
      openFrom: "10:00",
      openTo: "20:00",
      advantages: ["Работаем без выходных"],
    });
  });

  it("builds one direction per channel within the budget-guard share", () => {
    const plan = buildLaunchPlan(completeDraft(), "2026-11-02", 300);
    expect(plan.directions.map((d) => d.channel)).toEqual(["search", "network"]);
    const weekly = plan.directions.reduce((sum, d) => sum + d.weeklyLimitRub, 0);
    // Launch on 2 November: the month ceiling is floor(15 000 × 29 / 30) = 14 500 ₽; 90% of it over 5 weeks.
    expect(weekly).toBe(2_610);
  });

  it("gives the search direction the generated phrases and leads every ad to the owner's site", () => {
    const plan = buildLaunchPlan(completeDraft(), "2026-11-02", 300);
    expect(plan).toMatchObject({ landingUrl: "https://nogotok.example/", city: "Москва" });
    expect(plan.directions[0]).toMatchObject({ keywords: ["маникюр с покрытием", "маникюр москва"], negativeKeywords: ["обучение", "курсы маникюра"] });
    expect(plan.directions[1]).toMatchObject({ channel: "network", keywords: [] });
  });

  it("does not build a plan before the phrases are generated", () => {
    const draft = completeDraft();
    draft.keywords = null;
    expect(() => buildLaunchPlan(draft, "2026-11-02", 300)).toThrow(/phrases/);
  });

  it("takes the city from the first part of the address", () => {
    expect(cityOf("Москва, ул. Профсоюзная, 1")).toBe("Москва");
    expect(cityOf("Санкт-Петербург, Невский проспект, 10")).toBe("Санкт-Петербург");
    expect(cityOf("Тверь")).toBe("Тверь");
  });

  it("does not build a plan without a landing page", () => {
    const draft = completeDraft();
    draft.sources.siteUrl = "";
    expect(() => buildLaunchPlan(draft, "2026-11-02", 300)).toThrow(/landing page/);
  });

  it("drops partner sites when their share is below the platform minimum", () => {
    expect(startingWeeklyLimits(3_000, "2026-11-02", 300, { search: true, network: true })).toEqual({ search: 522, network: 0 });
  });
});
