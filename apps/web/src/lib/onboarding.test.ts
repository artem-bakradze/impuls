import { describe, expect, it } from "vitest";
import {
  budgetCeilingText,
  budgetTooLowMessage,
  buildLaunchPlan,
  draftAds,
  emptyDraft,
  firstIncompleteStep,
  leadsEstimateText,
  startingWeeklyLimits,
  stepProblems,
} from "./onboarding";
import type { OnboardingDraft } from "./onboarding";

const plain = (text: string) => text.replace(/ /g, " ");

const completeDraft = (): OnboardingDraft => {
  const draft = emptyDraft();
  draft.sources.mapsUrl = "https://yandex.ru/maps/org/123";
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
  draft.ads = draftAds(draft);
  draft.directConnected = true;
  return draft;
};

describe("wizard steps", () => {
  it("keeps «Дальше» disabled without any link or description", () => {
    expect(stepProblems(1, emptyDraft())).toHaveLength(1);
    const withText = emptyDraft();
    withText.sources.about = "Делаем маникюр у метро";
    expect(stepProblems(1, withText)).toEqual([]);
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
  it("uses only card facts and never invents a missing price", () => {
    const ads = draftAds(completeDraft());
    expect(plain(ads.search[0]?.title ?? "")).toBe("Маникюр с покрытием от 1 800 ₽");
    expect(ads.search[1]?.title).toBe("Педикюр");
    for (const ad of [...ads.search, ...ads.network]) {
      expect(ad.title.length).toBeLessThanOrEqual(56);
      expect(ad.text.length).toBeLessThanOrEqual(81);
    }
  });

  it("builds one direction per channel within the budget-guard share", () => {
    const plan = buildLaunchPlan(completeDraft(), "2026-11-02", 300);
    expect(plan.directions.map((d) => d.channel)).toEqual(["search", "network"]);
    const weekly = plan.directions.reduce((sum, d) => sum + d.weeklyLimitRub, 0);
    // Launch on 2 November: the month ceiling is floor(15 000 × 29 / 30) = 14 500 ₽; 90% of it over 5 weeks.
    expect(weekly).toBe(2_610);
  });

  it("drops partner sites when their share is below the platform minimum", () => {
    expect(startingWeeklyLimits(3_000, "2026-11-02", 300, { search: true, network: true })).toEqual({ search: 522, network: 0 });
  });
});
