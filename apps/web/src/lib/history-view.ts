import { toLocalDate } from "@impuls/core";
import { formatRub } from "./format";
import type { InsightCardModel } from "./insights-model";

export type HistoryAuthor = "service" | "user" | "cabinet";
export type Snapshot = Record<string, string | number | boolean | null>;

export const AUTHOR_LABELS: Record<HistoryAuthor, string> = {
  service: "Сервис",
  user: "Вы",
  cabinet: "Изменено в кабинете Директа",
};

export interface DiffRow {
  label: string;
  before: string;
  after: string;
}

export interface HistoryItem {
  id: string;
  at: string;
  author: HistoryAuthor;
  object: string;
  diff: DiffRow[];
  explanation: string;
  outcome: string | null;
  /** Agent turn that made the change, for «Как сервис принял это решение». */
  turnId: string | null;
  /** The insight of the decision, behind «Почему» (insights spec «Лента инсайтов и связь с историей»). */
  insight: InsightCardModel | null;
  status: "pending" | "applied" | "failed";
  reverted: boolean;
  rollback: { kind: "available"; consequences: string[] } | { kind: "unavailable"; reason: string };
  /** A budget-guard limit cut: folded into one row per day (change-history spec «Подстройки лимитов за день»). */
  budgetAdjustment: boolean;
}

/** Names for ids that appear in snapshots, so the history never shows raw identifiers. */
export interface Names {
  directions: Record<string, string>;
  /** Channel of each direction, so the history says «Реклама в поиске» instead of the internal direction name. */
  channels: Record<string, "search" | "network">;
  ads: Record<string, string>;
  strategies: Record<string, string>;
}

const STATUS_WORDS: Record<string, string> = { active: "работает", paused: "на паузе", missing: "не найдено" };

/** Card lists are stored as JSON in the snapshot; the history shows them as «Маникюр — 1 800 ₽; Педикюр». */
const listText = <T>(value: string | number | boolean, item: (entry: T) => string): string => {
  try {
    const list = JSON.parse(String(value)) as T[];
    return list.length === 0 ? "не указаны" : list.map(item).join("; ");
  } catch {
    return String(value);
  }
};

/** «0%», «−25%», «+20%» */
const signedPercent = (percent: number): string => (percent === 0 ? "0%" : `${percent > 0 ? "+" : "−"}${Math.abs(percent)}%`);

const show = (key: string, value: string | number | boolean | null | undefined, names: Names): string => {
  if (value === null || value === undefined) return "—";
  switch (key) {
    case "status":
      return STATUS_WORDS[String(value)] ?? String(value);
    case "weeklyLimit":
      return `${formatRub(Number(value))} в неделю`;
    case "strategyId":
      return names.strategies[String(value)] ?? "другой способ";
    case "csoMode":
      return value === "user" ? "своя сумма" : "подбираем сами";
    case "csoValue":
      return `до ${formatRub(Number(value))} за обращение`;
    case "monthlyBudgetRub":
      return `${formatRub(Number(value) * 100)} в месяц`;
    case "launched":
      return value === true ? "запущена" : "не запущена";
    case "card":
      return "тексты и цены мини-сайта";
    case "services":
      return listText(value, (s: { name: string; priceRub: number | null }) => (s.priceRub === null ? s.name : `${s.name} — ${formatRub(s.priceRub * 100)}`));
    case "advantages":
      return listText(value, (a: string) => a);
    case "category":
      return String(value) || "не указано";
    case "negativeKeywords": {
      const text = listText(value, (p: string) => `«${p}»`);
      return text === "не указаны" ? "нет" : text;
    }
    case "mobileAdjustment":
    case "desktopAdjustment":
      return signedPercent(Number(value));
    default:
      return key in names.directions ? (STATUS_WORDS[String(value)] ?? String(value)) : String(value);
  }
};

const LABELS: Record<string, string> = {
  status: "Показы",
  weeklyLimit: "Лимит расходов",
  strategyId: "Как Яндекс расходует деньги",
  schedule: "Время показа",
  city: "Город показа",
  csoMode: "Цена обращения",
  csoValue: "Цель",
  title: "Заголовок",
  text: "Текст",
  monthlyBudgetRub: "Бюджет",
  launched: "Реклама",
  card: "Мини-сайт",
  category: "Чем занимаетесь",
  services: "Услуги",
  advantages: "Преимущества",
  negativeKeywords: "Минус-фразы",
  mobileAdjustment: "Цена перехода с телефонов",
  desktopAdjustment: "Цена перехода с компьютеров и планшетов",
};

/** «Реклама в поиске» / «Реклама на сайтах-партнёрах»: what the owner chose, not the internal word «направление». */
const directionWords = (id: string, names: Names): string | null => {
  const channel = names.channels[id];
  if (channel === "search") return "Реклама в поиске";
  if (channel === "network") return "Реклама на сайтах-партнёрах";
  return names.directions[id] ? `Реклама «${names.directions[id]}»` : null;
};

const labelOf = (key: string, names: Names): string => LABELS[key] ?? directionWords(key, names) ?? key;

/** «было → стало» rows for the fields that changed; if nothing differs (e.g. a failed command), every field. */
export const describeDiff = (before: Snapshot, after: Snapshot, names: Names): DiffRow[] => {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = keys.filter((k) => before[k] !== after[k]);
  return (changed.length > 0 ? changed : keys).map((key) => ({ label: labelOf(key, names), before: show(key, before[key], names), after: show(key, after[key], names) }));
};

export const objectName = (objectKind: string, objectId: string, names: Names): string => {
  switch (objectKind) {
    case "direction":
      return directionWords(objectId, names) ?? "Реклама";
    case "ad":
      return names.ads[objectId] ? `Объявление «${names.ads[objectId]}»` : "Объявление";
    case "minisite":
      return "Мини-сайт";
    case "goal":
      return "Цель по цене обращения";
    case "card":
      return "Описание бизнеса";
    default:
      return "Вся реклама";
  }
};

/** The history is one feed, newest first (change-history spec). */
export const newestFirst = (items: readonly HistoryItem[]): HistoryItem[] => [...items].sort((a, b) => b.at.localeCompare(a.at));

/** Budget-guard limit cuts of one day as a single row: how each limit moved over the day, and every cut inside. */
export interface BudgetGroup {
  id: string;
  date: string;
  /** Newest first, as in the feed. */
  entries: HistoryItem[];
  /** Per advertising: the limit before the first cut of the day and after the last one. */
  limits: { object: string; from: string; to: string }[];
}

export type FeedRow = { kind: "entry"; item: HistoryItem } | { kind: "budget"; group: BudgetGroup };

/**
 * The feed with budget-guard limit cuts folded by local day (change-history spec): the day's row takes the place of
 * its newest cut; a day with a single cut shows it as is.
 */
export const foldBudgetAdjustments = (items: readonly HistoryItem[], timeZone: string): FeedRow[] => {
  const byDay = new Map<string, HistoryItem[]>();
  for (const item of items) {
    if (!item.budgetAdjustment) continue;
    const date = toLocalDate(new Date(item.at), timeZone);
    byDay.set(date, [...(byDay.get(date) ?? []), item]);
  }
  const rows: FeedRow[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const day = item.budgetAdjustment ? toLocalDate(new Date(item.at), timeZone) : null;
    const entries = day === null ? [] : (byDay.get(day) ?? []);
    if (day === null || entries.length < 2) {
      rows.push({ kind: "entry", item });
      continue;
    }
    if (placed.has(day)) continue;
    placed.add(day);
    const limits = new Map<string, { object: string; from: string; to: string }>();
    // Entries are newest first: the first seen is the day's last value, the last seen is its first.
    for (const entry of entries) {
      const row = entry.diff[0];
      if (!row) continue;
      const known = limits.get(entry.object);
      limits.set(entry.object, { object: entry.object, from: row.before, to: known?.to ?? row.after });
    }
    rows.push({ kind: "budget", group: { id: `budget-${day}`, date: day, entries, limits: [...limits.values()] } });
  }
  return rows;
};
