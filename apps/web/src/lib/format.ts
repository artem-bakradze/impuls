/** Money is kopecks everywhere in the backend; the UI shows whole rubles with a narrow no-break space. */
export const formatRub = (kopecks: number): string =>
  `${Math.floor(kopecks / 100).toLocaleString("ru-RU").replace(/\s/g, "\u00a0")}\u00a0₽`;

export const formatCount = (value: number): string => value.toLocaleString("ru-RU").replace(/\s/g, "\u00a0");

/** \u00ab1000 \u20bd\u00bb \u2192 \u00ab1 000 \u20bd\u00bb inside free text (the agent's and the rules' words), so money reads as on the numbers around it. */
export const groupRub = (text: string): string =>
  text.replace(/(?<![\d.,])(\d{4,})[ \u00a0]?\u20bd/g, (_, digits: string) => `${digits.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")}\u00a0\u20bd`);

const DATE = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

export const formatDateTime = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** LocalDate (YYYY-MM-DD) as «12 октября». */
export const formatLocalDate = (date: string): string => DATE.format(new Date(`${date}T12:00:00Z`));

/** Sentence case for backend messages that start lowercase («состояние объекта изменилось»). */
export const sentence = (text: string): string => (text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`);

/** Russian plural form for a count: plural(2, "раз", "раза", "раз") → «раза». */
export const plural = (n: number, one: string, few: string, many: string): string => {
  const tens = Math.abs(n) % 100;
  const last = Math.abs(n) % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (last === 1) return one;
  return last >= 2 && last <= 4 ? few : many;
};
