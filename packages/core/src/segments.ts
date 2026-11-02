import type { Kopecks } from "./types";

/** Stats of one segment of advertising — a search query or a device — over the last 14 days. */
export interface SegmentStats {
  segment: string;
  impressions: number;
  clicks: number;
  leads: number;
  spend: Kopecks;
}

/** Whether a segment has data enough for a conclusion, and how it compares with the goal (design decision 3). */
export type SegmentVerdict = "learning" | "within" | "above";

export const SEGMENT_VERDICT_TEXT: Record<SegmentVerdict, string> = {
  learning: "собираем данные",
  within: "в цели",
  above: "дороже цели",
};

/** Leads from which a cost per lead above the goal counts as «дороже цели». */
export const SEGMENT_MIN_LEADS = 3;
/** A segment with this much more than the goal per lead is «дороже цели». */
export const SEGMENT_OVER_GOAL = 1.2;

/**
 * Deterministic verdict of a segment against the goal (ad-agent spec «Разрезы данных по запросу агента»): the agent
 * and the guards see the same one. «В цели» needs a lead at most 1.2 × the goal; «дороже цели» — the goal spent without
 * a lead, or 3 leads above it; anything between (no lead yet, or one or two expensive ones) is still collecting data.
 */
export const segmentVerdict = (stats: Pick<SegmentStats, "clicks" | "leads" | "spend">, goal: Kopecks): SegmentVerdict => {
  if (stats.leads === 0) return stats.spend >= goal ? "above" : "learning";
  if (stats.spend / stats.leads <= goal * SEGMENT_OVER_GOAL) return "within";
  return stats.leads >= SEGMENT_MIN_LEADS ? "above" : "learning";
};

/** Lower-case words of a phrase or a query: «Маникюр, бесплатно!» → ["маникюр", "бесплатно"]. */
export const phraseWords = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");

/** A negative phrase matches a query when every word of the phrase is a word of the query. */
export const phraseMatches = (phrase: string, query: string): boolean => {
  const words = new Set(phraseWords(query));
  const own = phraseWords(phrase);
  return own.length > 0 && own.every((w) => words.has(w));
};

/** Short stable id of a search query for fact keys: «q-» and 8 hex digits of the FNV-1a hash of its words. */
export const querySegmentId = (query: string): string => {
  let hash = 0x811c9dc5;
  for (const char of phraseWords(query).join(" ")) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `q-${hash.toString(16).padStart(8, "0")}`;
};

/** Search queries sent to the model: at most this many, the most expensive first. */
export const MAX_QUERY_ROWS = 30;
const MIN_QUERY_CLICKS = 2;
const MIN_QUERY_IMPRESSIONS = 10;
const PERSONAL = [/\d{5,}/, /@/, /https?:\/\//i, /\bwww\./i, /\.(ru|рф|com|net|org|su|info)\b/i];

/**
 * Search queries are what people typed, so only repeated ones without phone numbers, e-mails or site addresses go to
 * the model (design decision 6); the agent is told how many were hidden.
 */
export const filterQueries = <T extends SegmentStats>(rows: readonly T[]): { rows: T[]; hidden: number } => {
  const repeated = rows.filter((r) => r.clicks >= MIN_QUERY_CLICKS || r.impressions >= MIN_QUERY_IMPRESSIONS);
  const clean = repeated.filter((r) => !PERSONAL.some((p) => p.test(r.segment)));
  const kept = [...clean].sort((a, b) => b.spend - a.spend).slice(0, MAX_QUERY_ROWS);
  return { rows: kept, hidden: rows.length - kept.length };
};

export const MAX_NEGATIVE_WORDS = 7;
export const MAX_NEGATIVE_WORD_LENGTH = 35;
export const MAX_NEGATIVE_TOTAL_LENGTH = 20_000;

/** Length rules of Direct for negative phrases; null when the phrase fits. */
export const negativePhraseLengthIssue = (phrase: string): string | null => {
  const words = phraseWords(phrase);
  if (words.length === 0) return "пустая минус-фраза";
  if (words.length > MAX_NEGATIVE_WORDS) return `в минус-фразе не больше ${MAX_NEGATIVE_WORDS} слов`;
  if (words.some((w) => w.length > MAX_NEGATIVE_WORD_LENGTH)) return `в слове минус-фразы не больше ${MAX_NEGATIVE_WORD_LENGTH} символов`;
  return null;
};

/** Combined length of negative phrases as Direct counts it: spaces, dashes and operators are not counted. */
export const negativeTotalLength = (phrases: readonly string[]): number => phrases.reduce((sum, p) => sum + phraseWords(p).join("").length, 0);
