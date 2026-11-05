import { addDays, toLocalDate } from "@impuls/core";
import type { Channel, Kopecks, LocalDate } from "@impuls/core";
import type { SimulatorState } from "@impuls/platforms";

/**
 * A period of stats the owner enters in a simulation (simulation-mode spec «Статистика периода от владельца»). Pure and
 * free of the platform adapters, so the window checks itself in the browser with the same rules the web and the worker
 * check again.
 */

export const PERIOD_DAYS = [1, 3, 7, 14] as const;
export type PeriodDays = (typeof PERIOD_DAYS)[number];

/** What the owner entered for one ad; money in whole rubles. */
export interface PeriodAdInput {
  adId: string;
  impressions: number;
  clicks: number;
  leads: number;
  spendRub: number;
}

export interface PeriodFormDirection {
  id: string;
  name: string;
  channel: Channel;
  ads: { id: string; title: string }[];
  /** What Direct would spend on the direction at most over each period from the current day, in whole rubles. */
  roomRub: Record<PeriodDays, number>;
}

/** The window: the ads shown now by direction, from the current day of the simulation. */
export interface PeriodForm {
  /** The current day's date: every period starts on it. */
  from: LocalDate;
  directions: PeriodFormDirection[];
}

export type PeriodField = "impressions" | "clicks" | "leads" | "spendRub";

/** One mistake of the window, said under its field or under its direction. */
export interface PeriodError {
  adId: string | null;
  directionId: string | null;
  field: PeriodField | null;
  message: string;
}

export const ADS_CHANGED_MESSAGE = "Реклама изменилась, пока окно было открыто: проверьте объявления и лимиты";

/** A simulation starts on the 1st of the month after `today`, so its month is a calendar month with the whole budget. */
export const simulationStartDate = (today: LocalDate): LocalDate => {
  const [year = 0, month = 1] = today.split("-").map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
};

/** The dates of a period that starts at `start`. */
export const periodDates = (start: Date, days: number, timeZone: string): LocalDate[] => {
  const first = toLocalDate(start, timeZone);
  return Array.from({ length: days }, (_, i) => addDays(first, i));
};

/**
 * Ads the market shows now: active, accepted and not stopped, in an active campaign. `room` is the market's spending room
 * of a campaign on each date (`campaignRoom` of `@impuls/platforms`).
 */
export const periodForm = (input: {
  state: Pick<SimulatorState, "campaigns" | "ads">;
  room: (platformCampaignId: string, dates: readonly LocalDate[]) => Kopecks[];
  directions: readonly { id: string; name: string; channel: Channel; platformCampaignId: string }[];
  ads: readonly { id: string; title: string; directionId: string; platformAdId: string }[];
  start: Date;
  timeZone: string;
}): PeriodForm => {
  const shownOnPlatform = new Set(
    input.state.ads.filter((a) => a.status === "active" && a.moderation === "accepted" && a.monitoringStopped !== true).map((a) => a.id),
  );
  const activeCampaigns = new Set(input.state.campaigns.filter((c) => c.status === "active").map((c) => c.id));
  const directions: PeriodFormDirection[] = [];
  for (const direction of input.directions) {
    if (!activeCampaigns.has(direction.platformCampaignId)) continue;
    const ads = input.ads.filter((a) => a.directionId === direction.id && shownOnPlatform.has(a.platformAdId)).map((a) => ({ id: a.id, title: a.title }));
    if (ads.length === 0) continue;
    const room = (days: PeriodDays) =>
      Math.floor(input.room(direction.platformCampaignId, periodDates(input.start, days, input.timeZone)).reduce((s, r) => s + r, 0) / 100);
    directions.push({ id: direction.id, name: direction.name, channel: direction.channel, ads, roomRub: { 1: room(1), 3: room(3), 7: room(7), 14: room(14) } });
  }
  return { from: toLocalDate(input.start, input.timeZone), directions };
};

const daysWord = (n: number): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дня" : "дней";
};

/** «4 200 ₽» with a no-break space between thousands, as the screens show money. */
const rub = (value: number): string => `${new Intl.NumberFormat("ru-RU").format(value).replace(/\s/g, " ")} ₽`;

/**
 * The window's checks (simulation-mode spec «Статистика периода от владельца»): numbers Direct would not send are
 * refused field by field, and an ad that is not shown any more means the advertising changed under the window.
 */
export const checkPeriod = (form: PeriodForm, days: PeriodDays, ads: readonly PeriodAdInput[]): { errors: PeriodError[]; changed: boolean } => {
  const errors: PeriodError[] = [];
  const directionOf = new Map(form.directions.flatMap((d) => d.ads.map((a) => [a.id, d] as const)));
  const changed = ads.some((a) => !directionOf.has(a.adId)) || new Set(ads.map((a) => a.adId)).size !== ads.length;
  if (changed) return { errors: [{ adId: null, directionId: null, field: null, message: ADS_CHANGED_MESSAGE }], changed };
  const at = (row: PeriodAdInput, field: PeriodField, message: string) => errors.push({ adId: row.adId, directionId: directionOf.get(row.adId)?.id ?? null, field, message });
  for (const row of ads) {
    if (row.clicks > row.impressions) at(row, "clicks", "Переходов не может быть больше, чем показов");
    if (row.leads > row.clicks) at(row, "leads", "Обращений не может быть больше, чем переходов");
    if (row.spendRub > 0 && row.clicks === 0) at(row, "spendRub", "Без переходов Директ ничего не списывает");
    if (row.clicks > 0 && row.spendRub === 0) at(row, "spendRub", "За переходы Директ списывает деньги — укажите расход");
  }
  for (const direction of form.directions) {
    const ids = new Set(direction.ads.map((a) => a.id));
    const spend = ads.filter((a) => ids.has(a.adId)).reduce((s, a) => s + a.spendRub, 0);
    const room = direction.roomRub[days];
    if (spend > room) {
      errors.push({ adId: null, directionId: direction.id, field: null, message: `Директ потратит на это направление не больше ${rub(room)} за ${days} ${daysWord(days)}` });
    }
  }
  return { errors, changed: false };
};
