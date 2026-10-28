import { formatRub } from "./format";

export type HistoryAuthor = "service" | "user" | "cabinet";
export type HistoryType = "budget" | "ads" | "experiments" | "settings";
export type Snapshot = Record<string, string | number | boolean | null>;

export const AUTHOR_LABELS: Record<HistoryAuthor, string> = {
  service: "Сервис",
  user: "Вы",
  cabinet: "Изменено в кабинете Директа",
};

export const TYPE_LABELS: Record<HistoryType, string> = {
  budget: "Бюджет",
  ads: "Объявления",
  experiments: "Проверки",
  settings: "Настройки",
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
  type: HistoryType;
  object: string;
  diff: DiffRow[];
  explanation: string;
  outcome: string | null;
  /** Agent turn that made the change, for «Как сервис принял это решение». */
  turnId: string | null;
  status: "pending" | "applied" | "failed";
  reverted: boolean;
  rollback: { kind: "available"; consequences: string[] } | { kind: "unavailable"; reason: string };
}

/** Names for ids that appear in snapshots, so the history never shows raw identifiers. */
export interface Names {
  directions: Record<string, string>;
  ads: Record<string, string>;
  strategies: Record<string, string>;
}

const BUDGET_ACTIONS = new Set(["SetSpendLimit", "SetStrategy", "PauseDirection", "ResumeDirection", "PauseAll", "ResumeAll"]);
const AD_ACTIONS = new Set(["PauseAd", "ResumeAd", "UpdateAdText"]);
const EXPERIMENT_ACTIONS = new Set(["StartExperiment", "FinishExperiment"]);

/** History filter groups (change-history spec): бюджет, объявления, эксперименты, настройки. */
export const historyType = (actionType: string, reasonCode: string, objectKind: string): HistoryType => {
  if (reasonCode === "USER_BUDGET" || reasonCode.startsWith("BUDGET_") || BUDGET_ACTIONS.has(actionType)) return "budget";
  if (AD_ACTIONS.has(actionType) || objectKind === "ad") return "ads";
  if (EXPERIMENT_ACTIONS.has(actionType)) return "experiments";
  return "settings";
};

const STATUS_WORDS: Record<string, string> = { active: "работает", paused: "на паузе", missing: "не найдено" };

const show = (key: string, value: string | number | boolean | null | undefined, names: Names): string => {
  if (value === null || value === undefined) return "—";
  switch (key) {
    case "status":
      return STATUS_WORDS[String(value)] ?? String(value);
    case "weeklyLimit":
      return `${formatRub(Number(value))} в неделю`;
    case "strategyId":
      return names.strategies[String(value)] ?? "другой способ";
    case "geoRadiusKm":
      return `${value} км`;
    case "monthlyBudgetRub":
      return `${formatRub(Number(value) * 100)} в месяц`;
    case "launched":
      return value === true ? "запущена" : "не запущена";
    case "card":
      return "тексты и цены мини-сайта";
    default:
      return key in names.directions ? (STATUS_WORDS[String(value)] ?? String(value)) : String(value);
  }
};

const LABELS: Record<string, string> = {
  status: "Показы",
  weeklyLimit: "Лимит расходов",
  strategyId: "Как Яндекс расходует деньги",
  schedule: "Время показа",
  geoRadiusKm: "Зона показа",
  title: "Заголовок",
  text: "Текст",
  monthlyBudgetRub: "Бюджет",
  launched: "Реклама",
  card: "Мини-сайт",
};

const labelOf = (key: string, names: Names): string => LABELS[key] ?? (names.directions[key] ? `Направление «${names.directions[key]}»` : key);

/** «было → стало» rows for the fields that changed; if nothing differs (e.g. a failed command), every field. */
export const describeDiff = (before: Snapshot, after: Snapshot, names: Names): DiffRow[] => {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = keys.filter((k) => before[k] !== after[k]);
  return (changed.length > 0 ? changed : keys).map((key) => ({ label: labelOf(key, names), before: show(key, before[key], names), after: show(key, after[key], names) }));
};

export const objectName = (objectKind: string, objectId: string, names: Names): string => {
  switch (objectKind) {
    case "direction":
      return names.directions[objectId] ? `Направление «${names.directions[objectId]}»` : "Направление";
    case "ad":
      return names.ads[objectId] ? `Объявление «${names.ads[objectId]}»` : "Объявление";
    case "minisite":
      return "Мини-сайт";
    default:
      return "Вся реклама";
  }
};

export interface HistoryFilter {
  author: HistoryAuthor | "all";
  type: HistoryType | "all";
  /** Days back from `now`; null — all time. */
  days: number | null;
}

/** Newest first, as the spec's «Только действия сервиса» scenario requires. */
export const filterHistory = (items: readonly HistoryItem[], filter: HistoryFilter, now: Date): HistoryItem[] =>
  items
    .filter((item) => filter.author === "all" || item.author === filter.author)
    .filter((item) => filter.type === "all" || item.type === filter.type)
    .filter((item) => filter.days === null || now.getTime() - new Date(item.at).getTime() <= filter.days * 86_400_000)
    .sort((a, b) => b.at.localeCompare(a.at));
