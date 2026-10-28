/** Money is kopecks everywhere in the backend; the UI shows whole rubles with a narrow no-break space. */
export const formatRub = (kopecks: number): string =>
  `${Math.floor(kopecks / 100).toLocaleString("ru-RU").replace(/\s/g, "\u00a0")}\u00a0₽`;

export const formatCount = (value: number): string => value.toLocaleString("ru-RU").replace(/\s/g, "\u00a0");

const DATE = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

export const formatDateTime = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** LocalDate (YYYY-MM-DD) as «12 октября». */
export const formatLocalDate = (date: string): string => DATE.format(new Date(`${date}T12:00:00Z`));

/** Sentence case for backend messages that start lowercase («состояние объекта изменилось»). */
export const sentence = (text: string): string => (text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`);
