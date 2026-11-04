import { daysBetween } from "@impuls/core";
import type { LocalDate } from "@impuls/core";
import { formatLocalDate, formatRange } from "./format";

/**
 * How the screen names a day. In Direct it is the calendar («9 ноября»); in a simulation the month is make-believe, so a
 * day is its number from the launch, the launch being day 1 (simulation-mode spec «Дни симуляции вместо дат»).
 */
export interface DayWords {
  simulation: boolean;
  /** «9 ноября» · «день 9» */
  date(date: LocalDate): string;
  /** «1–9 ноября» · «дни 1–9»; one day is `date`. */
  range(from: LocalDate, to: LocalDate): string;
  /** When something happens, before a verb: «9 ноября» · «в день 9» («… проверю»). */
  on(date: LocalDate): string;
  /** «к 9 ноября» · «ко дню 9» */
  by(date: LocalDate): string;
  /** «до 9 ноября» · «до дня 9» */
  until(date: LocalDate): string;
  /** The service's and the agent's own words: their calendar dates become days in a simulation. */
  text(text: string): string;
}

export const calendarWords: DayWords = {
  simulation: false,
  date: formatLocalDate,
  range: formatRange,
  on: formatLocalDate,
  by: (date) => `к ${formatLocalDate(date)}`,
  until: (date) => `до ${formatLocalDate(date)}`,
  text: (text) => text,
};

/** First letter up, for a phrase that opens a sentence: «В день 16 проверю». */
export const capitalize = (text: string): string => (text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`);

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «[предлог] D[–D] месяца [2026 [г.]]» inside free text; the preposition decides how «день N» is declined. */
const DATE_IN_TEXT = new RegExp(
  `(?<![\\p{L}\\d])(?:(ко|к|до|со|с|по|на|после|за)\\s+)?(\\d{1,2})(?:\\s*[–—-]\\s*(\\d{1,2}))?\\s+(${MONTHS.join("|")})(?:\\s+(\\d{4})(?:\\s*г\\.?)?)?(?![\\p{L}])`,
  "giu",
);

const ONE_DAY: Record<string, (n: number) => string> = {
  к: (n) => `ко дню ${n}`,
  ко: (n) => `ко дню ${n}`,
  до: (n) => `до дня ${n}`,
  с: (n) => `с дня ${n}`,
  со: (n) => `с дня ${n}`,
  по: (n) => `по день ${n}`,
  на: (n) => `на день ${n}`,
  после: (n) => `после дня ${n}`,
  за: (n) => `за день ${n}`,
};

const pad = (n: number): string => String(n).padStart(2, "0");

export const simulationWords = (startedOn: LocalDate): DayWords => {
  const dayOf = (date: LocalDate): number => daysBetween(startedOn, date) + 1;
  const startYear = Number(startedOn.slice(0, 4));
  /** The date a «D месяца» of the text means: the launch's year, or the next one when that would be half a year before. */
  const dateOf = (day: number, month: number, year: number | null): LocalDate | null => {
    if (day < 1 || day > 31) return null;
    const of = (y: number): LocalDate => `${y}-${pad(month)}-${pad(day)}`;
    if (year !== null) return of(year);
    const same = of(startYear);
    return daysBetween(same, startedOn) > 183 ? of(startYear + 1) : same;
  };
  const date = (d: LocalDate): string => `день ${dayOf(d)}`;
  return {
    simulation: true,
    date,
    range: (from, to) => (from === to ? date(to) : `дни ${dayOf(from)}–${dayOf(to)}`),
    on: (d) => `в день ${dayOf(d)}`,
    by: (d) => `ко дню ${dayOf(d)}`,
    until: (d) => `до дня ${dayOf(d)}`,
    text: (text) =>
      text.replace(DATE_IN_TEXT, (match: string, prep: string | undefined, a: string, b: string | undefined, monthName: string, year: string | undefined, offset: number) => {
        const month = MONTHS.indexOf(monthName.toLowerCase()) + 1;
        const y = year === undefined ? null : Number(year);
        const first = dateOf(Number(a), month, y);
        const last = b === undefined ? null : dateOf(Number(b), month, y);
        if (first === null || dayOf(first) < 1 || (b !== undefined && (last === null || dayOf(last) < dayOf(first)))) return match;
        const p = prep?.toLowerCase();
        const words =
          last !== null ? `${p === undefined ? "" : `${p} `}дни ${dayOf(first)}–${dayOf(last)}` : p === undefined ? `в день ${dayOf(first)}` : (ONE_DAY[p] ?? ((n: number) => `${p} день ${n}`))(dayOf(first));
        // A phrase that opens the text or a sentence starts with a capital, as the date's own number did.
        const before = text.slice(0, offset).trimEnd();
        const opens = before === "" || /[.!?:—]$/.test(before) || (prep !== undefined && prep[0] === prep[0]?.toUpperCase());
        return opens ? capitalize(words) : words;
      }),
  };
};

/** The words of a business: a simulation's days from its first day, or the calendar. */
export const dayWordsOf = (sim: { startedOn: LocalDate } | null | undefined): DayWords => (sim ? simulationWords(sim.startedOn) : calendarWords);
