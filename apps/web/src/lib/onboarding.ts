import { allowedWeeklyTotal, daysInMonth, monthBudget } from "@impuls/core";
import type { LocalDate } from "@impuls/core";
import type { CounterCheck, ExtractCardResult, LaunchPlan, WebJob } from "@impuls/worker";
import { z } from "zod";
import { formatRub } from "./format";

/** Wizard steps in the fixed order of the business-onboarding spec. */
/** Three steps (business-onboarding spec «Шаги мастера»): the card and the budget share one, the ads and the launch another. */
export const WIZARD_STEPS = [
  "Где вас найти?",
  "Вот как мы вас поняли",
  "Объявления и запуск",
] as const;

export const STEP_COUNT = WIZARD_STEPS.length;
/** Step 6 when the owner chose the simulation instead of Direct (business-onboarding spec «Превью и запуск»). */
export const SIMULATION_STEP_TITLE = "Запустите симуляцию";
export const MIN_BUDGET_RUB = 3_000;
export const RECOMMENDED_BUDGET_RUB = 10_000;
export const ABOUT_MAX_LENGTH = 1_000;
/** Yandex Direct text ad limits. */
export const AD_TITLE_MAX = 56;
export const AD_TEXT_MAX = 81;

export const GOAL_OPTIONS = [
  { value: "form", label: "Заявка или запись с сайта" },
  { value: "call", label: "Нажатие на номер телефона" },
  { value: "messenger", label: "Переход в WhatsApp/Telegram" },
  { value: "route", label: "Построение маршрута" },
] as const;

export const DAY_OPTIONS = ["Пн–Вс", "Пн–Пт", "Пн–Сб", "Вт–Вс"] as const;
/** «Круглосуточно» is 00:00–24:00; a closing hour before the opening one means «через полночь». */
export const ALL_DAY = { openFrom: "00:00", openTo: "24:00" } as const;
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

/** Why a partner-site ad shows a simple picture: the image model failed, or the month's paid pictures are spent. */
export const IMAGE_NOTES = {
  failed: "Не получилось нарисовать картинку — показываем простую",
  limit: "Лимит картинок на этот месяц исчерпан — показываем простую",
} as const;
export type ImageNote = keyof typeof IMAGE_NOTES;

/** A partner-site ad with its picture (network-ad-images); a draft made before the pictures has none yet. */
const NetworkAdDraft = AdDraft.extend({
  imageId: z.string().max(80).optional(),
  imageNote: z.enum(["failed", "limit"]).nullable().optional(),
});
export type NetworkAdDraft = z.infer<typeof NetworkAdDraft>;

/** Which picture a drawing is for: the ad's current picture, or its title while it has none yet. */
export const pictureKey = (ad: Pick<NetworkAdDraft, "title" | "imageId">): string => ad.imageId ?? `new:${ad.title}`;

/** Where the browser gets a picture: only the owner's own business may read it. */
export const adImageUrl = (imageId: string): string => `/api/ad-images/${encodeURIComponent(imageId)}`;

export const OnboardingDraftSchema = z.object({
  sources: z.object({ siteUrl: Url, mapsUrl: Url, vkUrl: Url, about: z.string().max(ABOUT_MAX_LENGTH) }),
  card: z.object({
    name: z.string().max(100),
    category: z.string().max(100),
    services: z.array(z.object({ name: z.string().max(100), priceRub: z.number().int().positive().nullable() })).max(20),
    address: z.string().max(200),
    /** City the ads are shown in; Direct targets regions, not a radius (simplify-mvp-scope). Old drafts have none. */
    city: z.string().max(100).default(""),
    days: z.enum(DAY_OPTIONS),
    openFrom: z.string().regex(/^\d{2}:00$/),
    openTo: z.string().regex(/^\d{2}:00$/),
    phone: z.string().max(30),
    typicalClient: z.string().max(300),
    advantages: z.array(z.string().max(100)).max(3),
    timeZone: z.enum(TIME_ZONES.map((t) => t.value) as [string, ...string[]]),
  }),
  goals: z.array(z.enum(GOAL_OPTIONS.map((g) => g.value) as [string, ...string[]])),
  /** Only the amount: the cost-per-lead goal is always selected automatically at launch (simplify-mvp-scope). */
  budget: z.object({ monthlyBudgetRub: z.number().int().positive().nullable() }),
  ads: z.object({ search: z.array(AdDraft).max(5), network: z.array(NetworkAdDraft).max(5) }).nullable(),
  /** Search phrases and negative phrases generated together with the ads; shown only in «Для специалистов». */
  keywords: z.object({ search: z.array(z.string()), negative: z.array(z.string()) }).nullable().default(null),
  directConnected: z.boolean(),
  /** Last Metrica counter check of the site on step 3; null until checked (analytics spec). */
  counter: z
    .object({ siteUrl: z.string(), status: z.enum(["found", "not_found", "unreachable"]), counterId: z.number().int().positive().nullable() })
    .nullable()
    .default(null),
});

export type OnboardingDraft = z.infer<typeof OnboardingDraftSchema>;

export const emptyDraft = (): OnboardingDraft => ({
  sources: { siteUrl: "", mapsUrl: "", vkUrl: "", about: "" },
  card: {
    name: "",
    category: "",
    services: [{ name: "", priceRub: null }],
    address: "",
    city: "",
    days: "Пн–Вс",
    openFrom: "10:00",
    openTo: "20:00",
    phone: "",
    typicalClient: "",
    advantages: [""],
    timeZone: "Europe/Moscow",
  },
  // The two most common ways small businesses get clients; the owner can uncheck them.
  goals: ["form", "call"],
  budget: { monthlyBudgetRub: null },
  ads: null,
  keywords: null,
  directConnected: false,
  counter: null,
});

/** The saved check result for the current site, or null when the site changed or was never checked. */
export const counterOf = (draft: OnboardingDraft): CounterCheck | null => {
  const saved = draft.counter;
  if (saved === null || saved.siteUrl !== draft.sources.siteUrl) return null;
  return saved.status === "found" ? { status: "found", counterId: saved.counterId } : { status: saved.status };
};

export const withCounter = (draft: OnboardingDraft, check: CounterCheck): OnboardingDraft => ({
  ...draft,
  counter: { siteUrl: draft.sources.siteUrl, status: check.status, counterId: check.status === "found" ? check.counterId : null },
});

export const COUNTER_MISSING_WARNING =
  "Без счётчика обращения с сайта не будут посчитаны, и сервис не поймёт, какая реклама приводит клиентов. Запустить рекламу это не мешает.";

/** Extraction found none of the main card facts: the step shows one notice instead of a mark at every field. */
export const cardMostlyEmpty = (card: OnboardingDraft["card"]): boolean =>
  !filled(card.name) && !filled(card.category) && !filled(card.address) && !card.services.some((s) => filled(s.name));

const filled = (value: string): boolean => value.trim().length > 0;

const SOURCE_NAMES: Record<LinkKind, string> = { site: "сайт", maps: "Яндекс Карты", vk: "ВКонтакте" };

/**
 * Card-step notice for links that could not be opened. A mostly empty card already has its single «почти ничего»
 * notice (business-onboarding spec), so nothing more is shown; otherwise the owner learns where the card came from.
 */
export const unreadableNotice = (unreadable: readonly LinkKind[], draft: OnboardingDraft): string | null => {
  if (unreadable.length === 0 || cardMostlyEmpty(draft.card)) return null;
  const from = filled(draft.sources.about) ? "вашему описанию" : "остальным ссылкам";
  return `Не получилось открыть: ${unreadable.map((u) => SOURCE_NAMES[u]).join(", ")}. Карточку заполнили по ${from} — проверьте её.`;
};

export type LinkKind = "site" | "maps" | "vk";

const withScheme = (value: string): string => (/^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, "")}`);

const parse = (value: string): URL | null => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
};

/** A real host: at least one dot and a top-level part of two or more letters («nogotok.ru», «ноготок.рф»). */
const hasDomain = (url: URL): boolean => /\.(?:xn--[a-z0-9-]+|[\p{L}a-z]{2,})$/iu.test(url.hostname);

const MAPS_HOST = /(^|\.)yandex\.(ru|com|by|kz|uz)$/i;
const VK_HOST = /(^|\.)(vk\.com|vk\.ru|vkontakte\.ru)$/i;

/**
 * Turns what the owner typed into a link: «nogotok.ru» → «https://nogotok.ru», «@nogotok» → «https://vk.com/nogotok».
 * Returns "" for an empty field and null when the text is not a link of this kind.
 */
export const normalizeLink = (kind: LinkKind, raw: string): string | null => {
  const value = raw.replace(/\s+/g, "");
  if (value === "") {
    return "";
  }
  const text = kind === "vk" && /^@?[\w.]+$/.test(value) && !value.includes(".") ? `vk.com/${value.replace(/^@/, "")}` : value;
  const link = withScheme(text);
  const url = parse(link);
  if (!url || !hasDomain(url)) {
    return null;
  }
  if (kind === "maps" && !(MAPS_HOST.test(url.hostname) && (url.pathname.startsWith("/maps") || url.hostname.startsWith("maps.")))) {
    return null;
  }
  if (kind === "vk" && !VK_HOST.test(url.hostname)) {
    return null;
  }
  return link;
};

const LINK_ERRORS: Record<LinkKind, string> = {
  site: "Не похоже на адрес сайта — например, nogotok.ru",
  maps: "Это не ссылка на Яндекс Карты — скопируйте её из адресной строки карточки организации",
  vk: "Это не ссылка на ВКонтакте — например, vk.com/nogotok",
};

const SOURCE_FIELDS = { siteUrl: "site", mapsUrl: "maps", vkUrl: "vk" } as const;

/** The draft with every link of step 1 in its full form; unrecognized links are left for the owner to fix. */
export const withNormalizedLinks = (draft: OnboardingDraft): OnboardingDraft => {
  const sources = { ...draft.sources };
  for (const [field, kind] of Object.entries(SOURCE_FIELDS) as [keyof typeof SOURCE_FIELDS, LinkKind][]) {
    sources[field] = normalizeLink(kind, sources[field]) ?? sources[field];
  }
  return { ...draft, sources };
};

/** Big cities outside Moscow time; the rest of the regions mostly live on Moscow time. */
const CITY_TIME_ZONES: Record<string, (typeof TIME_ZONES)[number]["value"]> = {
  калининград: "Europe/Kaliningrad",
  самара: "Europe/Samara",
  тольятти: "Europe/Samara",
  ижевск: "Europe/Samara",
  ульяновск: "Europe/Samara",
  саратов: "Europe/Samara",
  астрахань: "Europe/Samara",
  екатеринбург: "Asia/Yekaterinburg",
  челябинск: "Asia/Yekaterinburg",
  пермь: "Asia/Yekaterinburg",
  уфа: "Asia/Yekaterinburg",
  тюмень: "Asia/Yekaterinburg",
  оренбург: "Asia/Yekaterinburg",
  сургут: "Asia/Yekaterinburg",
  омск: "Asia/Omsk",
  новосибирск: "Asia/Novosibirsk",
  томск: "Asia/Novosibirsk",
  барнаул: "Asia/Novosibirsk",
  кемерово: "Asia/Novosibirsk",
  новокузнецк: "Asia/Novosibirsk",
  красноярск: "Asia/Novosibirsk",
  иркутск: "Asia/Irkutsk",
  "улан-удэ": "Asia/Irkutsk",
  владивосток: "Asia/Vladivostok",
  хабаровск: "Asia/Vladivostok",
};

/** Time zone by city: a known city outside Moscow time, otherwise Moscow time. */
export const timeZoneOf = (city: string): (typeof TIME_ZONES)[number]["value"] => CITY_TIME_ZONES[city.trim().toLowerCase().replace(/ё/g, "е")] ?? "Europe/Moscow";

export const timeZoneLabel = (timeZone: string): string => TIME_ZONES.find((t) => t.value === timeZone)?.label ?? timeZone;

export const hasOwnSite = (draft: OnboardingDraft): boolean => filled(draft.sources.siteUrl);

/** A field that keeps the owner on the step; `field` is the id of the form field to scroll to and highlight. */
export interface StepIssue {
  field: string;
  message: string;
}

/**
 * What the owner must fix before moving on, per field (step numbers are 1-based). Only what the service cannot work
 * without is required: the site, one service, the city, a goal, the budget, the ads and Direct.
 */
export const stepIssues = (step: number, draft: OnboardingDraft): StepIssue[] => {
  const issues: StepIssue[] = [];
  switch (step) {
    case 1: {
      const s = draft.sources;
      // Every ad leads to the owner's site; the mini-site is out of the MVP (replace-direct-sandbox decision 7).
      if (!filled(s.siteUrl)) {
        issues.push({ field: "siteUrl", message: "Укажите адрес вашего сайта — на него будет вести реклама" });
      }
      for (const [field, kind] of Object.entries(SOURCE_FIELDS) as [keyof typeof SOURCE_FIELDS, LinkKind][]) {
        if (filled(s[field]) && normalizeLink(kind, s[field]) === null) {
          issues.push({ field, message: LINK_ERRORS[kind] });
        }
      }
      break;
    }
    case 2: {
      const c = draft.card;
      if (!c.services.some((s) => filled(s.name))) issues.push({ field: "services", message: "Добавьте хотя бы одну услугу — о ней будут объявления" });
      if (!filled(c.city)) issues.push({ field: "city", message: "Укажите город — в нём будет показываться реклама" });
      if (c.openFrom === c.openTo) issues.push({ field: "hours", message: "Время открытия и закрытия совпадает — для работы без перерыва выберите «Круглосуточно»" });
      const b = draft.budget;
      if (b.monthlyBudgetRub === null) {
        issues.push({ field: "budget", message: "Укажите бюджет на месяц" });
      } else if (b.monthlyBudgetRub < MIN_BUDGET_RUB) {
        issues.push({ field: "budget", message: budgetTooLowMessage });
      }
      break;
    }
    case 3: {
      const ads = draft.ads;
      if (ads === null || ads.search.length + ads.network.length === 0) {
        issues.push({ field: "ads", message: "Оставьте хотя бы одно объявление" });
      } else if ([...ads.search, ...ads.network].some((a) => !filled(a.title) || !filled(a.text))) {
        issues.push({ field: "ads", message: "У каждого объявления должны быть заголовок и текст" });
      }
      if (draft.goals.length === 0) issues.push({ field: "goals", message: "Выберите хотя бы одно действие, которое считать обращением" });
      break;
    }
    default:
      break;
  }
  return issues;
};

/** Messages of `stepIssues`, in the order of the fields. */
export const stepProblems = (step: number, draft: OnboardingDraft): string[] => stepIssues(step, draft).map((issue) => issue.message);

/** First step that is not complete; the wizard may not be saved beyond it. */
/**
 * The step to open for a saved one. Drafts of the six-step wizard keep their place: the goals and the budget belong to
 * step 2 until the ads are written, the preview and the launch to step 3.
 */
export const wizardStepOf = (saved: number, draft: Pick<OnboardingDraft, "ads">): number => {
  if (saved >= 5) return STEP_COUNT;
  if (saved >= 3) return draft.ads === null ? 2 : STEP_COUNT;
  return Math.max(1, saved);
};

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

/** «в октябре», «1 ноября»: month names for the budget step. */
const MONTHS_IN = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
const MONTHS_OF = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const daysWord = (n: number): string => {
  const tens = n % 100;
  const last = n % 10;
  if (tens >= 11 && tens <= 14) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
};

/**
 * What the owner will spend, in their words (budget-guard rule for the launch month): «В октябре — не больше
 * 2 903 ₽» with the reason, then the full monthly amount from the 1st.
 */
export const budgetPlan = (monthlyBudgetRub: number, today: LocalDate): { headline: string; detail: string | null } => {
  const ceiling = monthBudget(monthlyBudgetRub, today, today);
  const full = formatRub(monthlyBudgetRub * 100);
  if (ceiling === monthlyBudgetRub * 100) {
    return { headline: `Не больше ${full} в месяц`, detail: null };
  }
  const month = Number(today.slice(5, 7)) - 1;
  const daysLeft = daysInMonth(today) - Number(today.slice(8, 10)) + 1;
  return {
    headline: `В ${MONTHS_IN[month] ?? ""} — не больше ${formatRub(ceiling)}`,
    detail: `До конца месяца ${daysLeft === 1 ? "остался" : "осталось"} ${daysLeft} ${daysWord(daysLeft)}, поэтому тратим только часть суммы. С 1 ${MONTHS_OF[(month + 1) % 12] ?? ""} — не больше ${full} в месяц.`,
  };
};

/**
 * Starting cost per lead: the goal is always selected automatically at launch. The niche reference table (design: Open Questions)
 * does not exist yet, so the interim start value aims at ~30 leads a month, rounded to 50 ₽; the optimizer
 * recalculates it after 20 leads. A start at ~10 leads kept every ad «learning» for a month on a 15 000 ₽ budget,
 * as the simulation mode showed (add-simulation-mode, optimization-engine delta).
 */
export const interimAutoGoalRub = (monthlyBudgetRub: number): number => Math.max(50, Math.round(monthlyBudgetRub / 30 / 50) * 50);

export const scheduleText = (card: OnboardingDraft["card"]): string => `${card.days} ${card.openFrom}–${card.openTo}`;

/** Hours in words for the owner: «круглосуточно», «с 22:00 до 02:00 (через полночь)». */
export const hoursWords = (card: OnboardingDraft["card"]): string => {
  if (card.openFrom === ALL_DAY.openFrom && card.openTo === ALL_DAY.openTo) {
    return `${card.days}, круглосуточно`;
  }
  return `${card.days} ${card.openFrom}–${card.openTo}${card.openTo < card.openFrom ? " (через полночь)" : ""}`;
};

/** What the business is called in direction names and summaries: the category, or the first service. */
export const businessLabel = (card: OnboardingDraft["card"]): string =>
  card.category.trim() || card.services.find((s) => filled(s.name))?.name.trim() || card.name.trim();

/**
 * «Что рекламируем» in the launch summary without repeats: «Маникюр с покрытием», not «Маникюр: Маникюр с покрытием»;
 * the category leads only when the services do not already say it.
 */
export const advertisedText = (card: OnboardingDraft["card"]): string => {
  const category = card.category.trim();
  const services = card.services.map((s) => s.name.trim()).filter(Boolean);
  if (services.length === 0) return businessLabel(card);
  if (category === "" || services.every((name) => name.toLowerCase().startsWith(category.toLowerCase()))) return services.join(", ");
  return `${category}: ${services.join(", ")}`;
};

/** The allowlisted public card that the worker and the agent read (`BusinessRecord.card`). */
export const agentCard = (draft: OnboardingDraft) => ({
  category: draft.card.category.trim(),
  services: draft.card.services.filter((s) => filled(s.name)).map((s) => ({ name: s.name.trim(), priceRub: s.priceRub })),
  area: draft.card.address.trim(),
  hours: scheduleText(draft.card),
  advantages: draft.card.advantages.map((a) => a.trim()).filter(filled),
  name: draft.card.name.trim(),
  address: draft.card.address.trim(),
  city: draft.card.city.trim(),
  siteUrl: draft.sources.siteUrl,
});

/** Card facts for ad generation (`generate_creatives` job): only what the owner confirmed on step 2. */
export type CardFacts = Extract<WebJob, { kind: "generate_creatives" }>["facts"];

export const cardFactsOf = (draft: OnboardingDraft): CardFacts => ({
  name: draft.card.name.trim(),
  category: draft.card.category.trim(),
  services: draft.card.services.filter((s) => filled(s.name)).map((s) => ({ name: s.name.trim(), priceRub: s.priceRub })),
  address: draft.card.address.trim(),
  city: draft.card.city.trim(),
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
      city: untouched || !filled(card.city) ? (found.address !== null ? cityOf(found.address).slice(0, 100) : card.city) : card.city,
      phone: text(card.phone, found.phone, 30),
      services: services.length > 0 && (untouched || !card.services.some((s) => filled(s.name))) ? services : card.services,
      advantages: advantages.length > 0 && (untouched || !card.advantages.some(filled)) ? advantages : card.advantages,
      ...(hours ? { days: found.days ?? card.days, openFrom: found.openFrom ?? card.openFrom, openTo: found.openTo ?? card.openTo } : {}),
    },
  };
};

/** City of the business: the first part of the address («Москва, ул. Профсоюзная, 1» → «Москва»). */
export const cityOf = (address: string): string => address.split(",")[0]?.trim() ?? "";

/** Drafts saved before the city field get it from the address (the owner can still correct it). */
export const withCity = (draft: OnboardingDraft): OnboardingDraft =>
  draft.card.city !== "" || draft.card.address.trim() === "" ? draft : { ...draft, card: { ...draft.card, city: cityOf(draft.card.address) } };

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
  const category = businessLabel(draft.card);
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
    // A picture still being drawn is not waited for: the worker draws a missing one at launch.
    const network = ads.network.map((ad) => ({ title: ad.title, text: ad.text, ...(ad.imageId !== undefined && { imageId: ad.imageId }) }));
    directions.push({ name: `${category} — Сайты-партнёры`, channel: "network", weeklyLimitRub: limits.network, keywords: [], negativeKeywords: [], ads: network });
  }
  return { landingUrl: draft.sources.siteUrl, city: draft.card.city.trim(), directions };
};
