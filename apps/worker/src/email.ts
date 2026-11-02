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

/**
 * The only notifications sent by email (campaign-settings spec): without the owner the ads stop or get worse.
 * They cannot be switched off. Every other notification is shown on the summary only.
 */
const SUBJECTS: Record<string, string> = {
  low_balance: "Пополните баланс в Яндекс Директе",
  token_revoked: "Потерян доступ к Яндекс Директу",
  moderation_rejected: "Яндекс не пропустил объявление",
};

export const subjectFor = (kind: string): string => {
  const subject = SUBJECTS[kind];
  if (subject === undefined) {
    throw new Error(`No email subject for notification kind ${kind}`);
  }
  return subject;
};

export const emailKinds = (): string[] => Object.keys(SUBJECTS);

/** Emails new notifications of the email kinds; the rest are marked handled, since the summary shows them. */
export const deliverNotifications = async (ctx: JobContext, mailer: Mailer, logger: Logger): Promise<number> => {
  let sent = 0;
  for (const notification of await ctx.store.unsentNotifications()) {
    // A simulated business never gets email: its events stay on the summary (simulation-mode spec).
    if (!(notification.kind in SUBJECTS) || (await ctx.store.getBusiness(notification.businessId)).mode === "simulation") {
      await ctx.store.markNotificationSent(notification.id, ctx.clock.now());
      continue;
    }
    const to = await ctx.store.ownerEmail(notification.businessId);
    await mailer.send({ to, subject: subjectFor(notification.kind), text: `${notification.message}\n\n— Импульс` });
    await ctx.store.markNotificationSent(notification.id, ctx.clock.now());
    logger.info("Notification emailed", { businessId: notification.businessId, kind: notification.kind, notificationId: notification.id });
    sent++;
  }
  return sent;
};

/** Team alert channel (design decision 13): emails incidents opened since the last delivery. */
export const deliverIncidents = async (ctx: JobContext, mailer: Mailer, teamEmail: string): Promise<number> => {
  const since = (await ctx.store.getCursor("*", "incidents")) ?? new Date(0);
  const fresh = (await ctx.store.incidents()).filter((i) => i.openedAt > since);
  for (const incident of fresh) {
    await mailer.send({
      to: teamEmail,
      subject: `[Impuls incident] ${incident.kind}${incident.businessId ? ` (${incident.businessId})` : ""}`,
      text: `${incident.message}\nOpened at ${incident.openedAt.toISOString()}`,
    });
  }
  const last = fresh.at(-1);
  if (last) {
    await ctx.store.setCursor("*", "incidents", last.openedAt);
  }
  return fresh.length;
};

