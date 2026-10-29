import { allowedWeeklyTotal, monthBudget } from "@impuls/core";
import type { LocalDate } from "@impuls/core";
import type { ExtractCardResult, LaunchPlan, WebJob } from "@impuls/worker";
import { z } from "zod";
import { formatRub } from "./format";

/** Wizard steps in the fixed order of the business-onboarding spec. */
export const WIZARD_STEPS = [
  "Где вас найти?",
  "Вот как мы вас поняли",
  "Что для вас клиент?",
  "Бюджет",
  "Как увидят ваши объявления",
  "Подключите Яндекс Директ",
  "Запуск",
] as const;

export const STEP_COUNT = WIZARD_STEPS.length;
export const MIN_BUDGET_RUB = 3_000;
export const RECOMMENDED_BUDGET_RUB = 10_000;
export const ABOUT_MAX_LENGTH = 1_000;
export const DEFAULT_RADIUS_KM = 3;
/** Yandex Direct text ad limits. */
export const AD_TITLE_MAX = 56;
export const AD_TEXT_MAX = 81;

export const GOAL_OPTIONS = [
  { value: "form", label: "Заявка или запись с сайта" },
  { value: "call", label: "Звонок по номеру с сайта" },
  { value: "messenger", label: "Сообщение в WhatsApp/Telegram" },
  { value: "route", label: "Построение маршрута" },
] as const;

export const DAY_OPTIONS = ["Пн–Вс", "Пн–Пт", "Пн–Сб"] as const;
export const HOUR_OPTIONS = Array.from({ length: 25 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
export const TIME_ZONES = [
  { value: "Europe/Kaliningrad", label: "Калининград (МСК−1)" },
  { value: "Europe/Moscow", label: "Москва (МСК)" },
  { value: "Europe/Samara", label: "Самара (МСК+1)" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург (МСК+2)" },
  { value: "Asia/Omsk", label: "Омск (МСК+3)" },
  { value: "Asia/Novosibirsk", label: "Новосибирск (МСК+4)" },
  { value: "Asia/Irkutsk", label: "Иркутск (МСК+5)" },
  { value: "Asia/Vladivostok", label: "Владивосток (МСК+7)" },
] as const;

const Url = z.union([z.literal(""), z.url({ protocol: /^https?$/ })]);

const AdDraft = z.object({ title: z.string().max(AD_TITLE_MAX), text: z.string().max(AD_TEXT_MAX) });
export type AdDraft = z.infer<typeof AdDraft>;

export const OnboardingDraftSchema = z.object({
  sources: z.object({ siteUrl: Url, mapsUrl: Url, vkUrl: Url, about: z.string().max(ABOUT_MAX_LENGTH) }),
  card: z.object({
    name: z.string().max(100),
    category: z.string().max(100),
    services: z.array(z.object({ name: z.string().max(100), priceRub: z.number().int().positive().nullable() })).max(20),
    address: z.string().max(200),
    radiusKm: z.number().int().min(1).max(50),
    days: z.enum(DAY_OPTIONS),
    openFrom: z.string().regex(/^\d{2}:00$/),
    openTo: z.string().regex(/^\d{2}:00$/),
    phone: z.string().max(30),
    typicalClient: z.string().max(300),
    advantages: z.array(z.string().max(100)).max(3),
    timeZone: z.enum(TIME_ZONES.map((t) => t.value) as [string, ...string[]]),
  }),
  goals: z.array(z.enum(GOAL_OPTIONS.map((g) => g.value) as [string, ...string[]])),
  budget: z.object({
    monthlyBudgetRub: z.number().int().positive().nullable(),
    goalMode: z.enum(["user", "auto"]),
    goalRub: z.number().int().positive().nullable(),
  }),
  ads: z.object({ search: z.array(AdDraft).max(5), network: z.array(AdDraft).max(5) }).nullable(),
  /** Search phrases and negative phrases generated together with the ads; shown only in «Для специалистов». */
  keywords: z.object({ search: z.array(z.string()), negative: z.array(z.string()) }).nullable().default(null),
  directConnected: z.boolean(),
});

export type OnboardingDraft = z.infer<typeof OnboardingDraftSchema>;

export const emptyDraft = (): OnboardingDraft => ({
  sources: { siteUrl: "", mapsUrl: "", vkUrl: "", about: "" },
  card: {
    name: "",
    category: "",
    services: [{ name: "", priceRub: null }],
    address: "",
    radiusKm: DEFAULT_RADIUS_KM,
    days: "Пн–Вс",
    openFrom: "10:00",
    openTo: "20:00",
    phone: "",
    typicalClient: "",
    advantages: [""],
    timeZone: "Europe/Moscow",
  },
  goals: [],
  budget: { monthlyBudgetRub: null, goalMode: "user", goalRub: null },
  ads: null,
  keywords: null,
  directConnected: false,
});

const filled = (value: string): boolean => value.trim().length > 0;

export const isWebUrl = (value: string): boolean => value !== "" && Url.safeParse(value).success;

export const hasOwnSite = (draft: OnboardingDraft): boolean => filled(draft.sources.siteUrl);

/** What blocks «Дальше» on a step; empty means the step is complete. Step numbers are 1-based. */
export const stepProblems = (step: number, draft: OnboardingDraft): string[] => {
  const problems: string[] = [];
  switch (step) {
    case 1: {
      const s = draft.sources;
      // Every ad leads to the owner's site; the mini-site is out of the MVP (replace-direct-sandbox decision 7).
      if (!filled(s.siteUrl)) {
        problems.push("Укажите адрес вашего сайта — на него будет вести реклама");
      }
      if ([s.siteUrl, s.mapsUrl, s.vkUrl].some((url) => filled(url) && !isWebUrl(url))) {
        problems.push("Проверьте ссылки: каждая должна начинаться с https://");
      }
      break;
    }
    case 2: {
      const c = draft.card;
      if (!filled(c.name)) problems.push("Укажите название");
      if (!filled(c.category)) problems.push("Укажите, чем вы занимаетесь");
      if (!c.services.some((s) => filled(s.name))) problems.push("Добавьте хотя бы одну услугу");
      if (!filled(c.address)) problems.push("Укажите адрес — от него считается зона показа");
      if (c.openFrom >= c.openTo) problems.push("Время закрытия должно быть позже времени открытия");
      break;
    }
    case 3:
      if (draft.goals.length === 0) problems.push("Выберите хотя бы одно действие, которое считать обращением");
      break;
    case 4: {
      const b = draft.budget;
      if (b.monthlyBudgetRub === null) {
        problems.push("Укажите бюджет на месяц");
      } else if (b.monthlyBudgetRub < MIN_BUDGET_RUB) {
        problems.push(budgetTooLowMessage);
      }
      if (b.goalMode === "user" && b.goalRub === null) {
        problems.push("Укажите, сколько готовы платить за одно обращение, или выберите «Не знаю — подберите сами»");
      }
      break;
    }
    case 5: {
      const ads = draft.ads;
      if (ads === null || ads.search.length + ads.network.length === 0) {
        problems.push("Оставьте хотя бы одно объявление");
      } else if ([...ads.search, ...ads.network].some((a) => !filled(a.title) || !filled(a.text))) {
        problems.push("У каждого объявления должны быть заголовок и текст");
      }
      break;
    }
    case 6:
      if (!draft.directConnected) problems.push("Подключите Яндекс Директ");
      break;
    default:
      break;
  }
  return problems;
};

/** First step that is not complete; the wizard may not be saved beyond it. */
export const firstIncompleteStep = (draft: OnboardingDraft): number => {
  for (let step = 1; step < STEP_COUNT; step++) {
    if (stepProblems(step, draft).length > 0) {
      return step;
    }
  }
  return STEP_COUNT;
};

export const budgetTooLowMessage =
  "Минимальный бюджет — 3 000 ₽ в месяц: с меньшей суммой Яндекс не может показывать рекламу стабильно";
export const budgetLowWarning =
  "С таким бюджетом обращений будет мало, и сервису понадобится больше времени, чтобы понять, какие объявления работают";

/**
 * Budget line under the amount (budget-guard rule for the launch month): prorated ceiling when the ads start
 * after the 1st, otherwise the plain promise.
 */
export const budgetCeilingText = (monthlyBudgetRub: number, today: LocalDate): string => {
  const ceiling = monthBudget(monthlyBudgetRub, today, today);
  if (ceiling === monthlyBudgetRub * 100) {
    return `Больше ${formatRub(ceiling)} за месяц мы не потратим`;
  }
  return `В этом месяце — до ${formatRub(ceiling)}, дальше — ${formatRub(monthlyBudgetRub * 100)} в месяц. Больше этой суммы за месяц мы не потратим`;
};

/** «при бюджете N ₽ и цене до M ₽ — до K обращений в месяц». */
export const leadsEstimateText = (monthlyBudgetRub: number, goalRub: number): string => {
  const leads = Math.floor(monthlyBudgetRub / goalRub);
  return `При бюджете ${formatRub(monthlyBudgetRub * 100)} и цене до ${formatRub(goalRub * 100)} — до ${leads} обращений в месяц, если удастся уложиться в цену`;
};

/**
 * Starting cost per lead for «Не знаю — подберите сами». The niche reference table (design: Open Questions)
 * does not exist yet, so the interim start value aims at ~10 leads a month, rounded to 50 ₽; the optimizer
 * recalculates it after 20 leads.
 */
export const interimAutoGoalRub = (monthlyBudgetRub: number): number => Math.max(50, Math.round(monthlyBudgetRub / 10 / 50) * 50);

export const scheduleText = (card: OnboardingDraft["card"]): string => `${card.days} ${card.openFrom}–${card.openTo}`;

/** The allowlisted public card that the worker and the agent read (`BusinessRecord.card`). */
export const agentCard = (draft: OnboardingDraft) => ({
  category: draft.card.category.trim(),
  services: draft.card.services.filter((s) => filled(s.name)).map((s) => ({ name: s.name.trim(), priceRub: s.priceRub })),
  area: `${draft.card.address.trim()}, радиус ${draft.card.radiusKm} км`,
  hours: scheduleText(draft.card),
  advantages: draft.card.advantages.map((a) => a.trim()).filter(filled),
});

/** Card facts for ad generation (`generate_creatives` job): only what the owner confirmed on step 2. */
export type CardFacts = Extract<WebJob, { kind: "generate_creatives" }>["facts"];

export const cardFactsOf = (draft: OnboardingDraft): CardFacts => ({
  name: draft.card.name.trim(),
  category: draft.card.category.trim(),
  services: draft.card.services.filter((s) => filled(s.name)).map((s) => ({ name: s.name.trim(), priceRub: s.priceRub })),
  address: draft.card.address.trim(),
  city: cityOf(draft.card.address),
  days: draft.card.days,
  openFrom: draft.card.openFrom,
  openTo: draft.card.openTo,
  advantages: draft.card.advantages.map((a) => a.trim()).filter(filled),
});

/**
 * Puts what extraction found into the card. A card the owner has not touched yet takes every found value; once the
 * owner typed something, only empty fields are filled. Nothing is invented: not found stays empty («Не нашли»).
 */
export const mergeExtractedCard = (draft: OnboardingDraft, found: ExtractCardResult["card"]): OnboardingDraft => {
  const card = draft.card;
  const untouched = !filled(card.name) && !filled(card.category) && !filled(card.address) && !card.services.some((s) => filled(s.name));
  const text = (current: string, value: string | null, max: number) => (value !== null && (untouched || !filled(current)) ? value.slice(0, max) : current);
  const services = found.services.slice(0, 20).map((s) => ({ name: s.name.slice(0, 100), priceRub: s.priceRub }));
  const advantages = found.advantages.map((a) => a.slice(0, 100)).slice(0, 3);
  const hours = untouched && found.days !== null && found.openFrom !== null && found.openTo !== null && found.openFrom < found.openTo;
  return {
    ...draft,
    card: {
      ...card,
      name: text(card.name, found.name, 100),
      category: text(card.category, found.category, 100),
      address: text(card.address, found.address, 200),
      phone: text(card.phone, found.phone, 30),
      services: services.length > 0 && (untouched || !card.services.some((s) => filled(s.name))) ? services : card.services,
      advantages: advantages.length > 0 && (untouched || !card.advantages.some(filled)) ? advantages : card.advantages,
      ...(hours ? { days: found.days ?? card.days, openFrom: found.openFrom ?? card.openFrom, openTo: found.openTo ?? card.openTo } : {}),
    },
  };
};

/** City of the business: the first part of the address («Москва, ул. Профсоюзная, 1» → «Москва»). */
export const cityOf = (address: string): string => address.split(",")[0]?.trim() ?? "";

export const SEARCH_SHARE = 0.6;

/**
 * Starting weekly limits: everything the budget-guard formula allows for the launch month
 * (`allowedWeeklyTotal` with nothing spent yet), 60% to search and 40% to partner sites. A channel whose share
 * is below the platform minimum is dropped and its money goes to the other.
 */
export const startingWeeklyLimits = (
  monthlyBudgetRub: number,
  today: LocalDate,
  minWeeklyLimitRub: number,
  channels: { search: boolean; network: boolean },
): { search: number; network: number } => {
  const totalRub = Math.floor(allowedWeeklyTotal(0, monthBudget(monthlyBudgetRub, today, today), today) / 100);
  if (channels.search && channels.network) {
    const search = Math.floor(totalRub * SEARCH_SHARE);
    const network = totalRub - search;
    if (network >= minWeeklyLimitRub && search >= minWeeklyLimitRub) {
      return { search, network };
    }
    return { search: totalRub, network: 0 };
  }
  return channels.search ? { search: totalRub, network: 0 } : { search: 0, network: totalRub };
};

/** «Запуск»: one direction per «услуги × канал» (design decision 5). */
export const buildLaunchPlan = (draft: OnboardingDraft, today: LocalDate, minWeeklyLimitRub: number): LaunchPlan => {
  const ads = draft.ads;
  const budget = draft.budget.monthlyBudgetRub;
  if (ads === null || budget === null) {
    throw new Error("Launch plan needs ads and a budget");
  }
  if (!hasOwnSite(draft)) {
    throw new Error("Launch plan needs a landing page");
  }
  if (draft.keywords === null) {
    throw new Error("Launch plan needs the generated phrases");
  }
  const limits = startingWeeklyLimits(budget, today, minWeeklyLimitRub, { search: ads.search.length > 0, network: ads.network.length > 0 });
  const category = draft.card.category.trim();
  const directions: LaunchPlan["directions"] = [];
  if (limits.search > 0 && ads.search.length > 0) {
    directions.push({
      name: `${category} — Поиск`,
      channel: "search",
      weeklyLimitRub: limits.search,
      keywords: draft.keywords.search,
      negativeKeywords: draft.keywords.negative,
      ads: ads.search,
    });
  }
  if (limits.network > 0 && ads.network.length > 0) {
    directions.push({ name: `${category} — Сайты-партнёры`, channel: "network", weeklyLimitRub: limits.network, keywords: [], negativeKeywords: [], ads: ads.network });
  }
  return { landingUrl: draft.sources.siteUrl, city: cityOf(draft.card.address), directions };
};
