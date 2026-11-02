/** Jargon that must not appear in user-facing explanations (change-history spec). */
export const JARGON_STOP_LIST = [
  "ctr",
  "конверси",
  "ставк",
  "рся",
  "ретаргетинг",
  "cpa",
  "cpc",
  "ключевые фразы",
  "ключевых фраз",
] as const;

export type Fact = { kind: "rub"; value: number } | { kind: "percent"; value: number } | { kind: "count"; value: number };

export interface ExplanationIssue {
  code: "JARGON" | "UNKNOWN_NUMBER";
  message: string;
}

/** «7 дней», also in a list: the 7 of «за 7 и 14 дней», «7–14 дней». */
const PERIOD_WORDS = /^\s*(?:(?:и|или|[-–—])\s*\d+\s*)?(дн|день|недел|месяц|час|минут|сутк|год|лет)/i;
/** «до 22:00», «10:00–20:00»: a time of day, not a number from the data. */
const TIME_OF_DAY = /\b\d{1,2}:\d{2}\b/g;
/** «к 22 ноября»: a calendar date says when, it is not a number from the data. */
const MONTHS_OF = /^\s*(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i;
const NUMBER = /(\d[\d\s ]*(?:[.,]\d+)?)\s*(₽|руб|%)?/g;

const parseNumber = (raw: string): number => Number(raw.replace(/[\s ]/g, "").replace(",", "."));

const formatRub = (value: number): string => `${value.toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;

/** Finds jargon and numbers in the text that do not match the decision facts. */
export const validateExplanation = (text: string, facts: readonly Fact[]): ExplanationIssue[] => {
  const issues: ExplanationIssue[] = [];
  const lower = text.toLowerCase();
  for (const word of JARGON_STOP_LIST) {
    // From the start of a word: «ставка» is jargon, «доставка» is not.
    if (new RegExp(`(?<![\\p{L}\\p{N}])${word}`, "u").test(lower)) {
      issues.push({ code: "JARGON", message: `слово «${word}» непонятно владельцу бизнеса` });
    }
  }
  const checked = text.replace(TIME_OF_DAY, " ");
  for (const match of checked.matchAll(NUMBER)) {
    const rawNumber = (match[1] ?? "").trim();
    const unit = match[2];
    const rest = checked.slice((match.index ?? 0) + match[0].length);
    if (unit === undefined && (PERIOD_WORDS.test(rest) || MONTHS_OF.test(rest))) {
      continue;
    }
    const value = parseNumber(rawNumber);
    if (unit === "%") {
      if (!facts.some((f) => f.kind === "percent" && Math.abs(f.value - value) <= 1)) {
        issues.push({ code: "UNKNOWN_NUMBER", message: `число ${rawNumber}% не найдено в данных` });
      }
    } else if (unit === "₽" || unit === "руб") {
      if (!facts.some((f) => f.kind === "rub" && f.value === value)) {
        issues.push({ code: "UNKNOWN_NUMBER", message: `число ${formatRub(value)} не найдено в данных` });
      }
    } else if (!facts.some((f) => f.value === value)) {
      issues.push({ code: "UNKNOWN_NUMBER", message: `число ${rawNumber} не найдено в данных` });
    }
  }
  return issues;
};
