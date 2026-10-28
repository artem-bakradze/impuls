import type { LocalDate } from "./types";

const parse = (date: LocalDate): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid local date: ${date}`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
};

const format = (date: Date): LocalDate => date.toISOString().slice(0, 10);

export const addDays = (date: LocalDate, days: number): LocalDate => {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
};

export const daysBetween = (from: LocalDate, to: LocalDate): number =>
  Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);

export const daysInMonth = (date: LocalDate): number => {
  const d = parse(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};

export const monthKey = (date: LocalDate): string => date.slice(0, 7);

export const endOfMonth = (date: LocalDate): LocalDate => `${monthKey(date)}-${String(daysInMonth(date)).padStart(2, "0")}`;

/** Monday of the ISO week that contains the date. */
export const weekStart = (date: LocalDate): LocalDate => {
  const weekday = (parse(date).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
};

/** Number of calendar weeks (Mon–Sun) that intersect [today, end of month]; partial weeks count as full. */
export const weeksLeftInMonth = (today: LocalDate): number => {
  const last = endOfMonth(today);
  return daysBetween(weekStart(today), weekStart(last)) / 7 + 1;
};

/** Converts an instant to the local date in the given IANA time zone. */
export const toLocalDate = (instant: Date, timeZone: string): LocalDate =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);

/** Hour of day (0–23) of an instant in the given IANA time zone. */
export const localHour = (instant: Date, timeZone: string): number =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(instant));
