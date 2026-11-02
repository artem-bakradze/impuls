import { addDays, toLocalDate, weekStart } from "@impuls/core";
import type { Kopecks, LocalDate } from "@impuls/core";
import { PlatformError } from "@impuls/platforms";
import { enqueueAgentEvent } from "./agent-turn";
import type { JobContext } from "./context";
import { aggregate } from "./state";

export const STATS_TOLERANCE_KOPECKS = 100;
export const STATS_STABLE_AFTER_DAYS = 3;
export const LOW_BALANCE_DAYS = 3;

const rub = (kopecks: number): string => `${Math.round(kopecks / 100).toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;

export class ClientConfirmationError extends Error {
  constructor(readonly code: "CLIENTS_OUT_OF_RANGE", message: string) {
    super(message);
  }
}

/** Weekly answer «сколько обращений стали клиентами» (analytics spec): 0 … number of leads that week. */
export const confirmClients = async (ctx: JobContext, businessId: string, week: LocalDate, clients: number): Promise<void> => {
  const start = weekStart(week);
  const rows = await ctx.store.stats(businessId, start, addDays(start, 6));
  const leads = rows.reduce((sum, r) => sum + r.leads, 0);
  if (Number.isInteger(clients) && clients > leads) {
    throw new ClientConfirmationError("CLIENTS_OUT_OF_RANGE", `Клиентов не может быть больше, чем обращений — за эту неделю их ${leads}`);
  }
  if (!Number.isInteger(clients) || clients < 0) {
    throw new ClientConfirmationError("CLIENTS_OUT_OF_RANGE", `Укажите число от 0 до ${leads}`);
  }
  await ctx.store.saveClientConfirmation({ businessId, weekStart: start, clients, leads });
};

export type ClientCost =
  | { kind: "known"; spend: Kopecks; clients: number; costPerClient: Kopecks | null }
  | { kind: "unknown"; costPerLead: Kopecks | null; hint: string };

/** Cost per client for a week; without the owner's answer shows cost per lead and a hint, never a guess. */
export const weeklyClientCost = async (ctx: JobContext, businessId: string, week: LocalDate): Promise<ClientCost> => {
  const start = weekStart(week);
  const rows = await ctx.store.stats(businessId, start, addDays(start, 6));
  const spend = rows.reduce((sum, r) => sum + r.spend, 0);
  const leads = rows.reduce((sum, r) => sum + r.leads, 0);
  const answer = (await ctx.store.clientConfirmations(businessId)).find((c) => c.weekStart === start);
  if (!answer) {
    return {
      kind: "unknown",
      costPerLead: leads === 0 ? null : Math.round(spend / leads),
      hint: "Ответьте, сколько обращений стали клиентами, чтобы видеть стоимость клиента",
    };
  }
  return { kind: "known", spend, clients: answer.clients, costPerClient: answer.clients === 0 ? null : Math.round(spend / answer.clients) };
};

/**
 * Weekly reconciliation (analytics spec): stored stats for days older than 3 days must match a fresh platform report
 * within 1 ₽ per campaign per day; deviations open an incident.
 */
export const reconcileStats = async (ctx: JobContext, businessId: string): Promise<string[]> => {
  const business = await ctx.store.getBusiness(businessId);
  const today = toLocalDate(ctx.clock.now(), business.timeZone);
  const to = addDays(today, -STATS_STABLE_AFTER_DAYS);
  const from = addDays(to, -27);
  const campaigns = (await ctx.store.directions(businessId)).map((d) => d.platformCampaignId);
  if (campaigns.length === 0) {
    return [];
  }
  const key = (r: { campaignId: string; date: string }) => `${r.campaignId}|${r.date}`;
  const stored = aggregate(await ctx.store.stats(businessId, from, to), key);
  const fresh = aggregate(await ctx.platformFor(businessId).getStats(campaigns, from, to), key);
  const deviations: string[] = [];
  for (const id of new Set([...stored.keys(), ...fresh.keys()])) {
    const a = stored.get(id)?.spend ?? 0;
    const b = fresh.get(id)?.spend ?? 0;
    if (Math.abs(a - b) > STATS_TOLERANCE_KOPECKS || (stored.get(id)?.leads ?? 0) !== (fresh.get(id)?.leads ?? 0)) {
      deviations.push(id);
    }
  }
  if (deviations.length > 0) {
    await ctx.store.openIncident({
      kind: "stats_mismatch",
      businessId,
      message: `Stats differ from the platform report for ${deviations.length} campaign-days: ${deviations.slice(0, 5).join(", ")}`,
      openedAt: ctx.clock.now(),
    });
  }
  return deviations;
};

/** Hourly: moderation results and account balance (platform-integration spec). */
export const checkModerationAndBalance = async (ctx: JobContext, businessId: string): Promise<void> => {
  const platform = ctx.platformFor(businessId);
  const directions = await ctx.store.directions(businessId);
  if (directions.length === 0) {
    return;
  }
  const platformAds = await platform.getAds(directions.map((d) => d.platformCampaignId));
  const rejected: string[] = [];
  for (const ad of await ctx.store.ads(businessId)) {
    const actual = platformAds.find((p) => p.id === ad.platformAdId);
    if (!actual || actual.moderation === ad.moderation) {
      continue;
    }
    await ctx.store.saveAd({ ...ad, moderation: actual.moderation });
    if (actual.moderation === "rejected") {
      rejected.push(ad.id);
      await ctx.store.notify({
        businessId,
        kind: "moderation_rejected",
        message: `Яндекс не пропустил объявление «${ad.title}»: ${actual.rejectionReason ?? "причина не указана"}. Я подготовлю исправленный вариант.`,
        at: ctx.clock.now(),
      });
    }
  }
  if (rejected.length > 0) {
    await enqueueAgentEvent(ctx, businessId, { kind: "moderation_rejected", adIds: rejected });
  }

  let balance: Kopecks;
  try {
    balance = await platform.getBalance();
  } catch (error) {
    if (error instanceof PlatformError && error.code === "NOT_SUPPORTED") {
      return;
    }
    throw error;
  }
  const business = await ctx.store.getBusiness(businessId);
  const today = toLocalDate(ctx.clock.now(), business.timeZone);
  const last7 = (await ctx.store.stats(businessId, addDays(today, -6), today)).reduce((sum, r) => sum + r.spend, 0);
  const perDay = last7 / 7;
  if (perDay <= 0) {
    return;
  }
  const daysLeft = Math.floor(balance / perDay);
  const notifiedToday = (await ctx.store.notifications(businessId)).some((n) => n.kind === "low_balance" && toLocalDate(n.at, business.timeZone) === today);
  if (daysLeft < LOW_BALANCE_DAYS && !notifiedToday) {
    await ctx.store.notify({
      businessId,
      kind: "low_balance",
      message: `Пополните баланс в Яндекс Директе — денег хватит примерно на ${daysLeft} дн. (осталось ${rub(balance)}).`,
      at: ctx.clock.now(),
    });
  }
};
