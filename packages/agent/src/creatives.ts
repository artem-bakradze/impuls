import { AD_LIMITS, validateAdText } from "@impuls/core";
import type { CreativeIssue, HypothesisKind } from "@impuls/core";
import { z } from "zod";
import type { LlmClient } from "./llm";

/**
 * Ad creatives (ad-creatives spec): business card extraction from public pages, ad texts with keywords and negative
 * keywords, and single-hypothesis variants for experiments. Two engines: the LLM one and a deterministic template
 * one for local stands and e2e (`CREATIVES=template`).
 */

export const WEEK_DAYS = ["Пн–Вс", "Пн–Пт", "Пн–Сб", "Вт–Вс"] as const;

/** Public facts about the business the texts may use; nothing outside this card may appear in an ad. */
export interface CardFacts {
  name: string;
  category: string;
  services: { name: string; priceRub: number | null }[];
  address: string;
  city: string;
  days: (typeof WEEK_DAYS)[number];
  openFrom: string;
  openTo: string;
  advantages: string[];
}

export interface AdDraft {
  title: string;
  text: string;
}

export interface Creatives {
  search: AdDraft[];
  network: AdDraft[];
  keywords: string[];
  negativeKeywords: string[];
}

export type { HypothesisKind } from "@impuls/core";

export interface HypothesisVariant extends AdDraft {
  hypothesis: string;
  changed: "title" | "text";
}

/** Text of one public page or of the owner's own description. */
export interface SourcePage {
  source: "site" | "maps" | "vk" | "about";
  text: string;
}

const HOUR = /^([01]\d|2[0-4]):00$/;

/** What the extraction found; `null` and empty lists mean «не нашли» and are never filled with invented values. */
export const CardDraftSchema = z
  .object({
    name: z.string().nullable(),
    category: z.string().nullable(),
    services: z.array(z.object({ name: z.string(), priceRub: z.number().int().positive().nullable() }).strict()),
    address: z.string().nullable(),
    days: z.enum(WEEK_DAYS).nullable(),
    openFrom: z.string().regex(HOUR).nullable(),
    openTo: z.string().regex(HOUR).nullable(),
    phone: z.string().nullable(),
    advantages: z.array(z.string()),
  })
  .strict();

export type CardDraft = z.infer<typeof CardDraftSchema>;

export const EMPTY_CARD_DRAFT: CardDraft = { name: null, category: null, services: [], address: null, days: null, openFrom: null, openTo: null, phone: null, advantages: [] };

export interface CreativeEngine {
  /** Whether `extractCard` uses page texts; the template engine finds nothing, so pages are not even downloaded. */
  readonly readsPages: boolean;
  extractCard(pages: readonly SourcePage[]): Promise<CardDraft>;
  generate(facts: CardFacts, channels: { search: boolean; network: boolean }): Promise<Creatives>;
  variant(facts: CardFacts, ad: AdDraft, kind: HypothesisKind): Promise<HypothesisVariant>;
}

export class CreativesError extends Error {
  constructor(
    readonly code: "NOT_ENOUGH_ADS" | "NO_KEYWORDS" | "VARIANT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "CreativesError";
  }
}

// --- Page text ---

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", mdash: "—", ndash: "–", rub: "₽" };

/** Visible text of an HTML page for extraction: scripts, styles and markup removed, capped at `maxChars`. */
export const htmlToText = (html: string, maxChars = 20_000): string =>
  html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity: string, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, maxChars);

// --- Facts ---

const digits = (priceRub: number): string[] => {
  const plain = String(priceRub);
  const grouped = priceRub.toLocaleString("ru-RU").replace(/\s/g, " ");
  return [...new Set([plain, grouped])];
};

/** Address words that identify the place: street and metro names, without the city and house numbers. */
const placeWords = (facts: CardFacts): string[] =>
  facts.address
    .split(/[,;]/)
    .slice(1)
    // `\b` is ASCII-only in JS, so the word boundary is a Unicode lookbehind.
    .map((part) => part.replace(/(?<!\p{L})(ул|улица|пр|проспект|м|метро|д|дом|корп|стр)(\.|\s|$)\s*/giu, "").replace(/\d+\S*/g, "").trim())
    .filter((part) => part.length >= 4);

/** Card facts an ad may quote; at least one must appear in every ad (`NO_FACT`). */
export const cardFacts = (facts: CardFacts): string[] => [
  ...facts.services.map((s) => s.name.toLowerCase()),
  ...facts.services.flatMap((s) => (s.priceRub === null ? [] : digits(s.priceRub))),
  ...placeWords(facts),
  `до ${facts.openTo}`,
  ...facts.advantages,
];

/** Prices and times in the ad that the card does not contain (spec: «ни один вариант не содержит фактов, которых нет в карточке»). */
export const inventedFacts = (ad: AdDraft, facts: CardFacts): CreativeIssue[] => {
  const text = `${ad.title} ${ad.text}`.replace(/[  ]/g, " ");
  const prices = new Set(facts.services.flatMap((s) => (s.priceRub === null ? [] : [s.priceRub])));
  const issues: CreativeIssue[] = [];
  for (const match of text.matchAll(/(\d[\d ]*)\s*(₽|руб)/giu)) {
    const value = Number((match[1] ?? "").replace(/ /g, ""));
    if (!prices.has(value)) {
      issues.push({ code: "NO_FACT", message: `цены ${value} ₽ нет в карточке бизнеса` });
    }
  }
  for (const match of text.matchAll(/(?<!\d)([01]?\d|2[0-4]):([0-5]\d)(?!\d)/g)) {
    const time = `${(match[1] ?? "").padStart(2, "0")}:${match[2] ?? ""}`;
    if (time !== facts.openFrom && time !== facts.openTo) {
      issues.push({ code: "NO_FACT", message: `времени ${time} нет в часах работы` });
    }
  }
  return issues;
};

/** Every check an ad must pass before it is shown to the owner or sent to the platform. */
export const checkAd = (ad: AdDraft, facts: CardFacts): CreativeIssue[] => [...validateAdText(ad, cardFacts(facts)), ...inventedFacts(ad, facts)];

// --- Keywords ---

/** Negative phrases against non-buyer searches for any niche (ad-creatives spec). */
export const BASE_NEGATIVE_KEYWORDS = ["обучение", "курсы", "вакансии", "своими руками", "бесплатно"] as const;

const MAX_KEYWORDS = 50;
/** Direct limits: up to 7 words per phrase; letters, digits, spaces and hyphens only in our phrases. */
const MAX_KEYWORD_WORDS = 7;

export const cleanPhrase = (text: string): string =>
  text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const cleanPhrases = (phrases: readonly string[], limit = MAX_KEYWORDS): string[] =>
  [...new Set(phrases.map(cleanPhrase).filter((p) => p !== "" && p.split(" ").length <= MAX_KEYWORD_WORDS))].slice(0, limit);

// --- Template engine ---

const clip = (text: string, max: number): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[.,;:—–-]+$/, "")}…`;
};

const rub = (priceRub: number): string => `${priceRub.toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`;

/** «Пн–Вс 10:00–20:00»; 00:00–24:00 reads «круглосуточно». */
const hoursText = (facts: CardFacts): string =>
  facts.openFrom === "00:00" && facts.openTo === "24:00" ? `${facts.days} круглосуточно` : `${facts.days} ${facts.openFrom}–${facts.openTo}`;

/**
 * Deterministic drafts from the card only, no LLM (local stand, e2e). Keeps the facts honest but does not meet the
 * «≥ 3 approaches» rule of the spec; production uses `LlmCreativeEngine`.
 */
export class TemplateCreativeEngine implements CreativeEngine {
  readonly readsPages = false;

  extractCard(): Promise<CardDraft> {
    return Promise.resolve(EMPTY_CARD_DRAFT);
  }

  generate(facts: CardFacts, channels: { search: boolean; network: boolean }): Promise<Creatives> {
    // Name, category and address are optional on the card (business-onboarding spec); empty parts are skipped.
    const lead = facts.advantages[0] ?? facts.category;
    const services = facts.services.filter((s) => s.name.trim() !== "");
    const search = channels.search
      ? services.slice(0, 3).map((service) => ({
          title: clip(service.priceRub === null ? service.name : `${service.name} от ${rub(service.priceRub)}`, AD_LIMITS.title),
          text: clip([lead, facts.address, hoursText(facts)].filter((part) => part.trim() !== "").join(". "), AD_LIMITS.text),
        }))
      : [];
    const network = channels.network
      ? [
          {
            title: clip([facts.name, facts.category].filter((part) => part.trim() !== "").join(" — ") || (services[0]?.name ?? ""), AD_LIMITS.title),
            text: clip([services.map((s) => s.name).slice(0, 3).join(", "), lead].filter((part) => part.trim() !== "").join(". "), AD_LIMITS.text),
          },
        ]
      : [];
    const city = cleanPhrase(facts.city);
    const names = services.map((s) => cleanPhrase(s.name));
    return Promise.resolve({
      search,
      network,
      keywords: channels.search ? cleanPhrases(names.flatMap((name) => (city === "" ? [name] : [name, `${name} ${city}`]))) : [],
      negativeKeywords: [...BASE_NEGATIVE_KEYWORDS],
    });
  }

  variant(facts: CardFacts, ad: AdDraft, kind: HypothesisKind): Promise<HypothesisVariant> {
    if (kind === "title") {
      const service = facts.services[0];
      const title = clip(service ? `${service.name} — ${facts.city}` : facts.name, AD_LIMITS.title);
      return Promise.resolve({ title, text: ad.text, changed: "title", hypothesis: "Проверяем, привлечёт ли заголовок с названием города больше обращений" });
    }
    const benefit = facts.advantages.find((a) => !ad.text.includes(a)) ?? `Работаем до ${facts.openTo}`;
    return Promise.resolve({ title: ad.title, text: clip(benefit, AD_LIMITS.text), changed: "text", hypothesis: `Проверяем, сработает ли преимущество «${benefit}» лучше нынешнего текста` });
  }
}

// --- LLM engine ---

const EXTRACT_INSTRUCTIONS = [
  "Ты извлекаешь карточку малого бизнеса из текста его страниц (сайт, Яндекс Карты, ВКонтакте) и описания владельца.",
  "Бери только то, что прямо написано в тексте. Если чего-то нет — верни null или пустой список. Ничего не придумывай и не угадывай.",
  "Цены — целые рубли за услугу; если указан диапазон или «от», бери нижнюю границу. Если цены нет — priceRub: null.",
  "days — одно из «Пн–Вс», «Пн–Пт», «Пн–Сб», «Вт–Вс», если режим работы прямо следует из текста; openFrom и openTo — в формате ЧЧ:00 (круглосуточно — 00:00 и 24:00; после полуночи — например, 22:00 и 02:00).",
  "advantages — до 3 коротких конкретных отличий из текста (например, «Работаем без выходных»), без оценочных слов вроде «лучший».",
  "address — город и адрес, например «Москва, ул. Профсоюзная, 1».",
].join("\n");

const AdsSchema = z.object({ title: z.string(), text: z.string(), approach: z.enum(["price", "convenience", "result", "newcomers"]) }).strict();
const GenerationSchema = z
  .object({ search: z.array(AdsSchema), network: z.array(AdsSchema), keywords: z.array(z.string()), negativeKeywords: z.array(z.string()) })
  .strict();
const RewriteSchema = z.object({ ads: z.array(z.object({ title: z.string(), text: z.string() }).strict()) }).strict();
const VariantSchema = z.object({ title: z.string(), text: z.string(), hypothesis: z.string() }).strict();

const GENERATE_INSTRUCTIONS = [
  "Ты пишешь текстовые объявления для Яндекс Директа для малого бизнеса по его карточке.",
  `Ограничения: заголовок до ${AD_LIMITS.title} символов, текст до ${AD_LIMITS.text} символов, считая пробелы.`,
  "Каждое объявление содержит хотя бы один конкретный факт из карточки: услугу, цену, улицу или метро, часы работы или преимущество.",
  "Используй только факты из карточки. Не придумывай цены, скидки, акции, сроки, адреса и часы, которых в карточке нет.",
  "Нельзя: превосходные степени («лучший», «№1», «самый»), гарантии результата, медицинские обещания, слова целиком заглавными буквами.",
  "Варианты отличаются подходом, а не формулировкой: price — цена; convenience — удобство (место, часы, запись); result — результат для клиента; newcomers — предложение для новых клиентов только если оно есть в карточке.",
  "search — 3–4 объявления для поиска; network — 3–4 объявления для сайтов-партнёров (короче, понятнее без поискового запроса). Пустой список, если канал не нужен.",
  "keywords — 10–30 поисковых фраз до 7 слов: услуги, услуги с городом и районом, как люди ищут эту услугу. Без брендов конкурентов.",
  "negativeKeywords — 10–20 минус-слов против нецелевых запросов для этой ниши: обучение, работа и вакансии, сделать самому дома, бесплатно, видео и т. п.",
  "Пиши по-русски, без рекламного жаргона.",
].join("\n");

const VARIANT_INSTRUCTIONS: Record<HypothesisKind, string> = {
  offer: "Измени только текст объявления: другое предложение из карточки (другая услуга с ценой, удобство или преимущество). Заголовок оставь как есть.",
  benefit: "Измени только текст объявления: подчеркни другую выгоду для клиента из карточки. Заголовок оставь как есть.",
  title: "Измени только заголовок: другой акцент из карточки. Текст оставь как есть.",
};

const factsInput = (facts: CardFacts): string =>
  JSON.stringify({
    название: facts.name,
    вид_деятельности: facts.category,
    услуги: facts.services.map((s) => (s.priceRub === null ? s.name : `${s.name} — ${s.priceRub} ₽`)),
    адрес: facts.address,
    часы_работы: hoursText(facts),
    преимущества: facts.advantages,
  });

const MAX_REWRITES = 2;
const MIN_ADS = 3;

/** Generation on an `LlmClient` with deterministic checks; failed texts are rewritten, never sent as is. */
export class LlmCreativeEngine implements CreativeEngine {
  readonly readsPages = true;

  constructor(private readonly llm: LlmClient) {}

  async extractCard(pages: readonly SourcePage[]): Promise<CardDraft> {
    const input = pages.map((page) => `### ${page.source}\n${page.text}`).join("\n\n");
    const draft = await this.llm.generate({ task: "extract_card", instructions: EXTRACT_INSTRUCTIONS, input, schema: CardDraftSchema });
    // The model must not invent: drop advantages with superlatives and keep at most three.
    const advantages = draft.advantages.filter((a) => validateAdText({ title: a, text: "" }).every((i) => i.code !== "SUPERLATIVE")).slice(0, 3);
    return { ...draft, advantages };
  }

  /** Codes of the checks the last rejected ads failed, for the error log. */
  private rejected: string[] = [];

  /** Keeps the ads that pass every check, asking the model to rewrite the rest with the reasons. */
  private async passing(ads: AdDraft[], facts: CardFacts): Promise<AdDraft[]> {
    let pending = ads;
    const good: AdDraft[] = [];
    this.rejected = [];
    for (let round = 0; round <= MAX_REWRITES && pending.length > 0; round++) {
      const failed: { ad: AdDraft; issues: CreativeIssue[] }[] = [];
      for (const ad of pending) {
        const issues = checkAd(ad, facts);
        if (issues.length === 0) good.push(ad);
        else failed.push({ ad, issues });
      }
      if (failed.length === 0 || round === MAX_REWRITES) {
        this.rejected = failed.flatMap((f) => f.issues.map((i) => i.code));
        break;
      }
      const rewrite = await this.llm.generate({
        task: "rewrite_ads",
        instructions: `${GENERATE_INSTRUCTIONS}\nПерепиши каждое объявление так, чтобы исправить перечисленные проблемы, сохранив подход.`,
        input: JSON.stringify({ карточка: JSON.parse(factsInput(facts)) as unknown, объявления: failed.map((f) => ({ ...f.ad, проблемы: f.issues.map((i) => i.message) })) }),
        schema: RewriteSchema,
      });
      pending = rewrite.ads;
    }
    return good;
  }

  async generate(facts: CardFacts, channels: { search: boolean; network: boolean }): Promise<Creatives> {
    const raw = await this.llm.generate({
      task: "generate_creatives",
      instructions: GENERATE_INSTRUCTIONS,
      input: JSON.stringify({ карточка: JSON.parse(factsInput(facts)) as unknown, каналы: { поиск: channels.search, сайты_партнёры: channels.network } }),
      schema: GenerationSchema,
    });
    const passed: { search: AdDraft[]; network: AdDraft[] } = { search: [], network: [] };
    for (const [channel, wanted, drafts] of [["search", channels.search, raw.search], ["network", channels.network, raw.network]] as const) {
      if (!wanted) continue;
      const ads = await this.passing(drafts.map(({ title, text }) => ({ title, text })), facts);
      if (ads.length < MIN_ADS) {
        throw new CreativesError("NOT_ENOUGH_ADS", `Only ${ads.length} ${channel} ads passed the checks; rejected: ${this.rejected.join(", ") || "none"}`);
      }
      passed[channel] = ads;
    }
    const { search, network } = passed;
    const keywords = channels.search ? cleanPhrases(raw.keywords) : [];
    if (channels.search && keywords.length === 0) {
      throw new CreativesError("NO_KEYWORDS", "No usable keywords were generated");
    }
    return { search, network, keywords, negativeKeywords: cleanPhrases([...BASE_NEGATIVE_KEYWORDS, ...raw.negativeKeywords]) };
  }

  async variant(facts: CardFacts, ad: AdDraft, kind: HypothesisKind): Promise<HypothesisVariant> {
    const changed = kind === "title" ? "title" : "text";
    for (let attempt = 0; attempt <= MAX_REWRITES; attempt++) {
      const answer = await this.llm.generate({
        task: "hypothesis_variant",
        instructions: `${GENERATE_INSTRUCTIONS}\n${VARIANT_INSTRUCTIONS[kind]}\nhypothesis — одна фраза простым языком: «Проверяем, …».`,
        input: JSON.stringify({ карточка: JSON.parse(factsInput(facts)) as unknown, объявление: ad }),
        schema: VariantSchema,
      });
      // Exactly one change: the untouched field is taken from the original whatever the model returned.
      const variant: HypothesisVariant = {
        title: changed === "title" ? answer.title : ad.title,
        text: changed === "text" ? answer.text : ad.text,
        hypothesis: answer.hypothesis,
        changed,
      };
      if (variant[changed] !== ad[changed] && checkAd(variant, facts).length === 0 && /^Проверяем/u.test(variant.hypothesis)) {
        return variant;
      }
    }
    throw new CreativesError("VARIANT_INVALID", "No valid single-change variant after rewrites");
  }
}
