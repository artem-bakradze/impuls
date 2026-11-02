import { validateExplanation } from "./explanations";
import type { Fact } from "./explanations";

/** What a fact measures (insights spec «Факты проверяются по данным»). */
export type InsightMetric =
  | "spend"
  | "impressions"
  | "clicks"
  | "leads"
  | "cost_per_lead"
  | "weekly_limit"
  | "budget"
  | "budget_spent"
  | "budget_left"
  | "budget_pace"
  | "goal";

/** Period of a fact: 14 days, the last 7, the 7 before them, the current month, the current value or an A/B check. */
export type InsightPeriod = "14d" | "7d" | "prev7d" | "month" | "now" | "check";

/** One entry of the snapshot's fact catalog; money in whole rubles, everything else in counts. */
export interface InsightFact {
  key: string;
  /** The object in the owner's words: «объявление „Маникюр у метро“», «реклама в поиске», «бюджет месяца». */
  object: string;
  metric: InsightMetric;
  period: InsightPeriod;
  value: number;
  unit: "rub" | "count";
}

/** What the agent says with an action or an observation; the facts are keys of the snapshot's catalog. */
export interface InsightDraft {
  reasonCode: string;
  observation: string;
  factKeys: string[];
  next: string;
  /** Only for an observation without an action: why nothing changes now. */
  decision?: string;
}

export interface InsightIssue {
  code: "EMPTY_TEXT" | "FACT_COUNT" | "UNKNOWN_FACT" | "JARGON" | "UNKNOWN_NUMBER";
  message: string;
}

/** Keys of the fact catalog, shared by the snapshot builder and the agent policies. */
export const factKey = {
  ad: (id: string, metric: InsightMetric, period: InsightPeriod): string => `ad:${id}:${metric}:${period}`,
  direction: (id: string, metric: InsightMetric, period: InsightPeriod): string => `direction:${id}:${metric}:${period}`,
  channel: (channel: "search" | "network", metric: InsightMetric, period: InsightPeriod): string => `channel:${channel}:${metric}:${period}`,
  budget: (metric: "budget" | "budget_spent" | "budget_left" | "budget_pace"): string => `budget:${metric}:month`,
  goal: (): string => "goal:goal:now",
  /** A search query or a device of a direction over 14 days, from a breakdown the agent asked for in the turn. */
  segment: (directionId: string, dimension: "query" | "device", segmentId: string, metric: InsightMetric): string =>
    `segment:${directionId}:${dimension}:${segmentId}:${metric}:14d`,
};

/** The ad or direction a fact is about, from its key; a segment's fact is about its direction. */
export const factObjectRef = (key: string): { kind: "ad" | "direction"; id: string } | null => {
  const [kind, id] = key.split(":");
  if (kind === "segment" && id) return { kind: "direction", id };
  return (kind === "ad" || kind === "direction") && id ? { kind, id } : null;
};

export const MIN_INSIGHT_FACTS = 2;
export const MAX_INSIGHT_FACTS = 4;

/** Catalog values as facts for checking the numbers in free texts. */
export const catalogFacts = (catalog: readonly InsightFact[]): Fact[] =>
  catalog.map((f) => (f.unit === "rub" ? { kind: "rub", value: f.value } : { kind: "count", value: f.value }));

/** Characters of an object id that must match from its end for a key to count as a misspelling of it. */
const ID_TAIL = 8;

const commonTail = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};

/**
 * The catalog key an unknown key most likely meant: the same kind of object, measure and period, and an id with the
 * same ending (a model may garble the start of a long id). Null when nothing is close.
 */
const closestKey = (key: string, catalog: readonly InsightFact[]): string | null => {
  const [kind, id, metric, period] = key.split(":");
  if (kind === undefined || id === undefined || metric === undefined || period === undefined) return null;
  let best: { key: string; tail: number } | null = null;
  for (const fact of catalog) {
    const [k, i, m, p] = fact.key.split(":");
    if (k !== kind || m !== metric || p !== period || i === undefined) continue;
    const tail = commonTail(i, id);
    if (tail >= ID_TAIL && (best === null || tail > best.tail)) best = { key: fact.key, tail };
  }
  return best?.key ?? null;
};

/**
 * Deterministic check of an insight before anything is executed (insights spec): 2–4 facts, every key from the
 * catalog, the texts in plain words with numbers that are in the data. `extraFacts` are other numbers the turn may
 * cite (e.g. a limit +20%).
 */
export const validateInsight = (draft: InsightDraft, catalog: readonly InsightFact[], extraFacts: readonly Fact[] = []): InsightIssue[] => {
  const issues: InsightIssue[] = [];
  const texts = [draft.observation, draft.next, ...(draft.decision === undefined ? [] : [draft.decision])];
  if (texts.some((t) => t.trim() === "")) {
    issues.push({ code: "EMPTY_TEXT", message: "нужны тексты «что заметили» и «что дальше»" });
  }
  if (draft.factKeys.length < MIN_INSIGHT_FACTS || draft.factKeys.length > MAX_INSIGHT_FACTS) {
    issues.push({ code: "FACT_COUNT", message: `нужно от ${MIN_INSIGHT_FACTS} до ${MAX_INSIGHT_FACTS} фактов из данных` });
  }
  const keys = new Set(catalog.map((f) => f.key));
  for (const key of draft.factKeys) {
    if (!keys.has(key)) {
      const near = closestKey(key, catalog);
      issues.push({ code: "UNKNOWN_FACT", message: `таких данных у сервиса нет: ${key}${near === null ? "" : ` — возможно, нужен ключ ${near}`}` });
    }
  }
  const facts = [...catalogFacts(catalog), ...extraFacts];
  for (const text of texts) {
    for (const issue of validateExplanation(text, facts)) {
      // One message per problem even when two texts share it.
      if (!issues.some((i) => i.message === issue.message)) issues.push(issue);
    }
  }
  return issues;
};
