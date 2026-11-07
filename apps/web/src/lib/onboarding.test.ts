import { describe, expect, it } from "vitest";
import {
  ALL_DAY,
  budgetCeilingText,
  budgetPlan,
  budgetTooLowMessage,
  buildLaunchPlan,
  cardFactsOf,
  cityOf,
  emptyDraft,
  firstIncompleteStep,
  GOAL_MISSING_MESSAGE,
  goalSource,
  hoursWords,
  OnboardingDraftSchema,
  ownGoalText,
  mergeExtractedCard,
  normalizeLink,
  startingWeeklyLimits,
  stepIssues,
  stepProblems,
  wizardStepOf,
  timeZoneOf,
  unreadableNotice,
  withCity,
  withNormalizedLinks,
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
    city: "Москва",
    advantages: ["Работаем без выходных"],
  };
  draft.goals = ["call"];
  draft.budget = { ...draft.budget, monthlyBudgetRub: 15_000 };
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
      city: "Москва",
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

  it("says where the card came from when the site could not be opened, and stays silent on a mostly empty card", () => {
    const draft = emptyDraft();
    draft.sources.about = "Студия маникюра в Казани";
    const filled = mergeExtractedCard(draft, found);
    expect(unreadableNotice(["site"], filled)).toBe("Не получилось открыть: сайт. Карточку заполнили по вашему описанию — проверьте её.");
    expect(unreadableNotice(["maps", "vk"], mergeExtractedCard(emptyDraft(), found))).toBe(
      "Не получилось открыть: Яндекс Карты, ВКонтакте. Карточку заполнили по остальным ссылкам — проверьте её.",
    );
    expect(unreadableNotice([], filled)).toBeNull();
    // The card step shows its single «почти ничего не получилось прочитать» notice instead.
    expect(unreadableNotice(["site"], draft)).toBeNull();
  });
});

describe("wizard steps", () => {
  it("needs the owner's site, even with a Maps link and a description, and points at the field", () => {
    expect(stepIssues(1, emptyDraft())).toEqual([{ field: "siteUrl", message: "Укажите адрес вашего сайта — на него будет вести реклама" }]);
    const mapsOnly = emptyDraft();
    mapsOnly.sources.mapsUrl = "https://yandex.ru/maps/org/123";
    mapsOnly.sources.about = "Делаем маникюр у метро";
    expect(stepProblems(1, mapsOnly)).toEqual(["Укажите адрес вашего сайта — на него будет вести реклама"]);
    mapsOnly.sources.siteUrl = "nogotok.ru";
    expect(stepProblems(1, mapsOnly)).toEqual([]);
  });

  it("takes links the way owners type them", () => {
    expect(normalizeLink("site", "nogotok.ru")).toBe("https://nogotok.ru");
    expect(normalizeLink("site", " www.nogotok.ru ")).toBe("https://www.nogotok.ru");
    expect(normalizeLink("site", "ноготок.рф")).toBe("https://ноготок.рф");
    expect(normalizeLink("site", "http://nogotok.ru/price")).toBe("http://nogotok.ru/price");
    expect(normalizeLink("site", "taplink.cc/nogotok")).toBe("https://taplink.cc/nogotok");
    expect(normalizeLink("vk", "@nogotok")).toBe("https://vk.com/nogotok");
    expect(normalizeLink("vk", "nogotok")).toBe("https://vk.com/nogotok");
    expect(normalizeLink("vk", "vk.com/nogotok")).toBe("https://vk.com/nogotok");
    expect(normalizeLink("maps", "yandex.ru/maps/org/nogotok/123")).toBe("https://yandex.ru/maps/org/nogotok/123");
    expect(normalizeLink("maps", "https://yandex.ru/maps/-/CDabc")).toBe("https://yandex.ru/maps/-/CDabc");
    expect(normalizeLink("site", "")).toBe("");
  });

  it("refuses what is not a link of its kind, with a plain hint at the field", () => {
    expect(normalizeLink("site", "nogotok")).toBeNull();
    expect(normalizeLink("site", "https://nogotok")).toBeNull();
    expect(normalizeLink("maps", "https://2gis.ru/firm/123")).toBeNull();
    expect(normalizeLink("vk", "https://instagram.com/nogotok")).toBeNull();
    const draft = emptyDraft();
    draft.sources.siteUrl = "nogotok";
    draft.sources.mapsUrl = "2gis.ru/firm/123";
    expect(stepIssues(1, draft)).toEqual([
      { field: "siteUrl", message: "Не похоже на адрес сайта — например, nogotok.ru" },
      { field: "mapsUrl", message: "Это не ссылка на Яндекс Карты — скопируйте её из адресной строки карточки организации" },
    ]);
  });

  it("saves links in their full form", () => {
    const draft = emptyDraft();
    draft.sources = { siteUrl: "nogotok.ru", mapsUrl: "", vkUrl: "@nogotok", about: "" };
    expect(withNormalizedLinks(draft).sources).toMatchObject({ siteUrl: "https://nogotok.ru", vkUrl: "https://vk.com/nogotok" });
  });

  it("does not let the budget go below 3 000 ₽ but accepts 5 000 ₽", () => {
    const draft = completeDraft();
    draft.budget.monthlyBudgetRub = 2_000;
    expect(stepProblems(2, draft)).toContain(budgetTooLowMessage);
    draft.budget.monthlyBudgetRub = 5_000;
    expect(stepProblems(2, draft)).toEqual([]);
  });

  it("needs no cost per lead by default: «Подбирайте сами» is chosen in advance", () => {
    const draft = completeDraft();
    draft.budget = { ...draft.budget, monthlyBudgetRub: 10_000 };
    expect(draft.budget.goalMode).toBe("auto");
    expect(stepProblems(2, draft)).toEqual([]);
  });

  it("asks for the sum once «Укажу сумму» is chosen, at the goal field", () => {
    const draft = completeDraft();
    draft.budget = { ...draft.budget, goalMode: "user", goalRub: null };
    expect(stepIssues(2, draft)).toEqual([{ field: "goal", message: GOAL_MISSING_MESSAGE }]);
    expect(firstIncompleteStep(draft)).toBe(2);
    draft.budget.goalRub = 500;
    expect(stepProblems(2, draft)).toEqual([]);
  });

  it("needs a city on the card step", () => {
    const draft = completeDraft();
    draft.card.city = "";
    expect(stepProblems(2, draft)).toEqual(["Укажите город — в нём будет показываться реклама"]);
  });

  it("asks on the card step only for a service and the city: name, category and address are optional", () => {
    const draft = completeDraft();
    draft.card = { ...draft.card, name: "", category: "", address: "", city: "Казань" };
    expect(stepIssues(2, draft)).toEqual([]);
    draft.card.services = [{ name: " ", priceRub: null }];
    expect(stepIssues(2, draft)).toEqual([{ field: "services", message: "Добавьте хотя бы одну услугу — о ней будут объявления" }]);
  });

  it("accepts hours past midnight and round the clock, but not equal hours", () => {
    const draft = completeDraft();
    draft.card = { ...draft.card, openFrom: "22:00", openTo: "02:00" };
    expect(stepIssues(2, draft)).toEqual([]);
    expect(hoursWords(draft.card)).toBe("Пн–Вс 22:00–02:00 (через полночь)");
    draft.card = { ...draft.card, ...ALL_DAY, days: "Вт–Вс" };
    expect(hoursWords(draft.card)).toBe("Вт–Вс, круглосуточно");
    draft.card = { ...draft.card, openFrom: "10:00", openTo: "10:00" };
    expect(stepIssues(2, draft)[0]?.field).toBe("hours");
  });

  it("picks the time zone by the city", () => {
    expect(timeZoneOf("Екатеринбург")).toBe("Asia/Yekaterinburg");
    expect(timeZoneOf(" новосибирск ")).toBe("Asia/Novosibirsk");
    expect(timeZoneOf("Тверь")).toBe("Europe/Moscow");
  });

  it("names directions by the first service when the category is empty", () => {
    const draft = completeDraft();
    draft.card.category = "";
    expect(buildLaunchPlan(draft, "2026-11-02", 300).directions[0]?.name).toBe("Маникюр с покрытием — Поиск");
  });

  it("gives a draft saved before the city field the city from its address", () => {
    const draft = completeDraft();
    draft.card.city = "";
    expect(withCity(draft).card.city).toBe("Москва");
    draft.card.city = "Химки";
    expect(withCity(draft).card.city).toBe("Химки");
  });

  it("reports the first incomplete step so progress cannot skip ahead", () => {
    const draft = completeDraft();
    expect(firstIncompleteStep(draft)).toBe(3);
    draft.budget.monthlyBudgetRub = null;
    expect(firstIncompleteStep(draft)).toBe(2);
    // The goals are on the last step, chosen in advance and changed in the launch summary.
    expect(stepProblems(3, { ...completeDraft(), goals: [] })).toEqual(["Выберите хотя бы одно действие, которое считать обращением"]);
  });

  it("opens a draft of the six-step wizard on the step that holds its place now", () => {
    const draft = completeDraft();
    expect(wizardStepOf(1, draft)).toBe(1);
    expect(wizardStepOf(2, draft)).toBe(2);
    expect(wizardStepOf(4, { ...draft, ads: null })).toBe(2);
    expect(wizardStepOf(4, draft)).toBe(3);
    expect(wizardStepOf(6, draft)).toBe(3);
  });
});

describe("budget plan", () => {
  const plain = (text: string | null) => (text ?? "").replace(/[\u00a0\u202f]/g, " ");

  it("says the full sum when the ads start on the 1st", () => {
    const plan = budgetPlan(15_000, "2026-11-01");
    expect(plain(plan.headline)).toBe("Не больше 15 000 ₽ в месяц");
    expect(plan.detail).toBeNull();
  });

  it("says why the first month is smaller and when the full sum starts", () => {
    const plan = budgetPlan(15_000, "2026-10-31");
    expect(plain(plan.headline)).toBe("В октябре — не больше 483 ₽");
    expect(plain(plan.detail)).toBe("До конца месяца остался 1 день, поэтому тратим только часть суммы. С 1 ноября — не больше 15 000 ₽ в месяц.");
    expect(plain(budgetPlan(15_000, "2026-12-10").detail)).toMatch(/осталось 22 дня.*С 1 января/);
  });
});

describe("budget texts", () => {
  it("prorates the first month when ads start after the 1st", () => {
    // 4 of 31 days remain in October: floor(15 000 × 4 / 31) = 1 935 ₽.
    expect(plain(budgetCeilingText(15_000, "2026-10-28"))).toBe("В этом месяце — до 1 935 ₽, дальше — 15 000 ₽ в месяц. Больше этой суммы за месяц мы не потратим");
    expect(plain(budgetCeilingText(15_000, "2026-11-01"))).toBe("Больше 15 000 ₽ за месяц мы не потратим");
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
    const draft = completeDraft();
    draft.card.city = "Химки";
    const plan = buildLaunchPlan(draft, "2026-11-02", 300);
    expect(plan).toMatchObject({ landingUrl: "https://nogotok.example/", city: "Химки" });
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

describe("the goal chosen next to the budget (business-onboarding «Выбор бюджета»)", () => {
  const withBudget = (budget: Partial<OnboardingDraft["budget"]>): OnboardingDraft => {
    const draft = emptyDraft();
    draft.budget = { ...draft.budget, ...budget };
    return draft;
  };

  it("reads a draft from before the goal as «Подбирайте сами» and keeps the sum within the settings' bounds", () => {
    const stored = { ...emptyDraft(), budget: { monthlyBudgetRub: 15_000 } };
    expect(OnboardingDraftSchema.parse(stored).budget).toEqual({ monthlyBudgetRub: 15_000, goalMode: "auto", goalRub: null });
    for (const goalRub of [0, 1_000_001, 12.5]) {
      expect(OnboardingDraftSchema.safeParse({ ...stored, budget: { monthlyBudgetRub: 15_000, goalMode: "user", goalRub } }).success).toBe(false);
    }
    expect(OnboardingDraftSchema.parse({ ...stored, budget: { monthlyBudgetRub: 15_000, goalMode: "user", goalRub: 1_000_000 } }).budget.goalRub).toBe(1_000_000);
  });

  it("gives the owner's own sum as the goal, and automatic selection otherwise", () => {
    expect(goalSource(withBudget({ monthlyBudgetRub: 15_000, goalMode: "user", goalRub: 500 }))).toEqual({ kind: "user", goal: 50_000 });
    // 15 000 ₽ / 30 = 500 ₽: the interim reference of automatic selection.
    expect(goalSource(withBudget({ monthlyBudgetRub: 15_000, goalMode: "auto", goalRub: 500 }))).toEqual({ kind: "auto", reference: 50_000 });
    expect(goalSource(withBudget({ monthlyBudgetRub: 15_000, goalMode: "user", goalRub: null }))).toEqual({ kind: "auto", reference: 50_000 });
    expect(goalSource(withBudget({ monthlyBudgetRub: null }))).toEqual({ kind: "auto", reference: 0 });
  });

  it("names only the owner's own goal in the summary", () => {
    expect(plain(ownGoalText(withBudget({ goalMode: "user", goalRub: 500 }).budget) ?? "")).toBe("Цель — до 500 ₽ за обращение");
    expect(ownGoalText(withBudget({ goalMode: "auto", goalRub: 500 }).budget)).toBeNull();
    expect(ownGoalText(withBudget({ goalMode: "user", goalRub: null }).budget)).toBeNull();
  });
});
