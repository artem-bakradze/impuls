import { formatLocalDate, formatRange } from "./format";
import type { JournalEntry } from "./service-work";

/**
 * The studio's review as a marketer's note (simulation-mode spec «Симуляция как отдельный режим»): what the service
 * sees, what it did and what it expects, in the service's own words — nothing here adds a number of its own.
 */

/** «Разбор недели · 9 ноября», «Разбор дня · 11 ноября». */
export const noteTitle = (entry: Pick<JournalEntry, "weekly" | "date" | "from">): string =>
  `${entry.weekly ? "Разбор недели" : "Разбор дня"} · ${entry.from !== null ? formatRange(entry.from, entry.date) : formatLocalDate(entry.date)}`;

/** «Что вижу»: the service's reasoning, then what its closed checks found. */
export const noteSeen = (entry: Pick<JournalEntry, "headline" | "paragraphs" | "found">): string[] => {
  const [first, ...rest] = entry.paragraphs;
  const reasoning = entry.headline === null ? entry.paragraphs : [first === undefined ? entry.headline : `${entry.headline} ${first}`, ...rest];
  const found = entry.found.map((h) => `Выяснил: ${h.statement.replace(/[.…]+$/, "")} — ${h.outcome.replace(/[.…]+$/, "")}.${h.result ? ` ${h.result}` : ""}`);
  return [...reasoning, ...found].filter((p) => p.trim().length > 0);
};

/** A change as a sentence of «Что сделал». */
export const noteSentence = (text: string): string => text.trim().replace(/[.…]+$/, "");

// «К 16 ноября проверю …», «Через неделю проверим …», «Повторно проверю …»: a sentence that only names a check.
const ONLY_CHECK = /^(?:(?:к|до|через|после)\s[^,—]*?\s)?(?:повторно\s)?(?:провер|сравн|вернусь|вернёмся|вернемся|оцен|посмотр)/i;
const ASKED = /^провер(?:яю|ю|яем|им)\s*[,:—-]?\s*/i;

const joinClauses = (clauses: string[]): string =>
  clauses.length <= 1 ? (clauses[0] ?? "") : `${clauses.slice(0, -1).join(", ")} и ${clauses.at(-1) ?? ""}`;

/**
 * «Чего жду»: what the decisions should change, then the open checks by day — «16 ноября проверю, продолжит ли … и
 * останется ли …». With checks on their days, a «Что дальше» that only names a check is not read twice.
 */
export const noteExpect = (entry: Pick<JournalEntry, "expects" | "checking">): string[] => {
  const effects = entry.checking.length > 0 ? entry.expects.filter((e) => !ONLY_CHECK.test(e.trim())) : entry.expects;
  const days = [...new Set(entry.checking.map((h) => h.checkOn))].sort();
  const checks = days.map((day) => {
    const clauses = entry.checking
      .filter((h) => h.checkOn === day)
      .map((h) => {
        const statement = h.statement.trim().replace(/[.…]+$/, "");
        const asked = ASKED.exec(statement);
        return asked ? statement.slice(asked[0].length) : `верно ли, что ${statement[0]?.toLowerCase() ?? ""}${statement.slice(1)}`;
      });
    return `${formatLocalDate(day)} проверю, ${joinClauses(clauses)}.`;
  });
  return [...effects, ...checks];
};
