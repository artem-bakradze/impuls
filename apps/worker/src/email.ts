import { addDays, localHour, toLocalDate, weekStart } from "@impuls/core";
import nodemailer from "nodemailer";
import type { JobContext } from "./context";
import type { Logger } from "./logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Outgoing email port; SMTP in production, Mailpit locally and in tests. */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export class SmtpMailer implements Mailer {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  constructor(smtpUrl: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }
  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
  }
}

/** Critical notifications cannot be switched off (campaign-settings spec). */
export const CRITICAL_KINDS = new Set(["low_balance", "token_revoked", "budget_80", "budget_95"]);

const SUBJECTS: Record<string, string> = {
  low_balance: "Пополните баланс в Яндекс Директе",
  token_revoked: "Потерян доступ к Яндекс Директу",
  budget_80: "Израсходовано 80% бюджета месяца",
  budget_95: "Бюджет месяца почти израсходован — реклама остановлена",
  moderation_rejected: "Яндекс не пропустил объявление",
  approval_request: "Нужно ваше подтверждение",
  experiment_finished: "Проверка объявлений завершена",
  goal_unreachable: "Обращения дороже вашей цели",
  underspend: "Тратим меньше бюджета ради вашей цели",
  minisite_price_changed: "Цена на сайте изменилась — обновить объявления?",
  weekly_summary: "Итоги рекламы за неделю",
};

export const subjectFor = (kind: string): string => {
  const subject = SUBJECTS[kind];
  if (subject === undefined) {
    throw new Error(`No email subject for notification kind ${kind}`);
  }
  return subject;
};

export const emailKinds = (): string[] => Object.keys(SUBJECTS);

/** Sends every stored notification that has not been emailed yet. */
export const deliverNotifications = async (ctx: JobContext, mailer: Mailer, logger: Logger): Promise<number> => {
  let sent = 0;
  for (const notification of await ctx.store.unsentNotifications()) {
    const to = await ctx.store.ownerEmail(notification.businessId);
    await mailer.send({ to, subject: subjectFor(notification.kind), text: `${notification.message}\n\n— Импульс` });
    await ctx.store.markNotificationSent(notification.id, ctx.clock.now());
    logger.info("Notification emailed", { businessId: notification.businessId, kind: notification.kind, notificationId: notification.id });
    sent++;
  }
  return sent;
};

export const WEEKLY_SUMMARY_HOUR = 10;

const rub = (kopecks: number): string => `${Math.round(kopecks / 100).toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;

/** Monday 10:00 local time: last week's numbers, the service's actions and the clients question. */
export const queueWeeklySummary = async (ctx: JobContext, businessId: string, appUrl: string): Promise<boolean> => {
  const business = await ctx.store.getBusiness(businessId);
  const now = ctx.clock.now();
  const today = toLocalDate(now, business.timeZone);
  if (!business.weeklySummaryEnabled || weekStart(today) !== today || localHour(now, business.timeZone) !== WEEKLY_SUMMARY_HOUR) {
    return false;
  }
  const from = addDays(today, -7);
  const to = addDays(today, -1);
  const rows = await ctx.store.stats(businessId, from, to);
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const leads = rows.reduce((s, r) => s + r.leads, 0);
  const actions = (await ctx.store.changes(businessId)).filter(
    (c) => (c.actor === "agent" || c.actor === "safety_net" || c.actor === "budget_guard") && c.status === "applied" && toLocalDate(c.createdAt, business.timeZone) >= from,
  );
  const lines = [
    `За неделю потрачено ${rub(spend)}, обращений: ${leads}${leads > 0 ? `, одно обращение стоило ${rub(Math.round(spend / leads))}` : ""}.`,
    actions.length === 0 ? "Изменений в рекламе не было." : `Что я сделал: ${actions.slice(0, 3).map((a) => a.explanation).join(" ")}`,
    `Сколько обращений стали клиентами? Ответьте здесь: ${appUrl}/summary?clients=${weekStart(from)}`,
  ];
  await ctx.store.notify({ businessId, kind: "weekly_summary", message: lines.join("\n\n"), at: now });
  return true;
};
