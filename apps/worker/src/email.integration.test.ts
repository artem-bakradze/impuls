import { IdlePolicy } from "@impuls/agent";
import { JARGON_STOP_LIST, rubles } from "@impuls/core";
import { describe, expect, it } from "vitest";
import { deliverNotifications, emailKinds, queueWeeklySummary, SmtpMailer, subjectFor } from "./email";
import type { EmailMessage, Mailer } from "./email";
import { createLogger } from "./logger";
import { SimulationDriver } from "./simulation";
import type { MemoryStore } from "./store";

// Requires Mailpit: docker run -d --rm -p 1025:1025 -p 8025:8025 axllent/mailpit
const MAILPIT_SMTP = process.env.MAILPIT_SMTP_URL ?? "";
const MAILPIT_API = process.env.MAILPIT_API_URL ?? "";
if (MAILPIT_SMTP === "" || MAILPIT_API === "") {
  throw new Error("MAILPIT_SMTP_URL and MAILPIT_API_URL are required for email integration tests");
}

const world = async () => {
  const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 2, agent: new IdlePolicy() });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: 30_000,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth: { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) } }] }],
  });
  (sim.store as MemoryStore).emails.set("b1", "owner@example.com");
  return sim;
};

class CapturingMailer implements Mailer {
  readonly sent: EmailMessage[] = [];
  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

describe("email templates", () => {
  it("have a plain subject without jargon for every notification kind", () => {
    for (const kind of emailKinds()) {
      const subject = subjectFor(kind).toLowerCase();
      expect(JARGON_STOP_LIST.some((w) => subject.includes(w))).toBe(false);
    }
    expect(() => subjectFor("unknown")).toThrow();
  });
});

describe("weekly summary", () => {
  it("is queued on Monday at 10:00 local time with the clients question, and can be switched off", async () => {
    const sim = await world();
    await sim.runHours(24 * 11 + 7); // until Monday 12 Oct 10:00 Moscow (07:00 UTC)
    expect(await queueWeeklySummary(sim.ctx, "b1", "https://app.example")).toBe(true);
    const summary = (await sim.store.notifications("b1")).find((n) => n.kind === "weekly_summary");
    expect(summary?.message).toMatch(/^За неделю потрачено .+ ₽, обращений: \d+/);
    expect(summary?.message).toContain("Сколько обращений стали клиентами? Ответьте здесь: https://app.example/summary?clients=2026-10-05");

    await sim.store.saveBusiness({ ...(await sim.store.getBusiness("b1")), weeklySummaryEnabled: false });
    expect(await queueWeeklySummary(sim.ctx, "b1", "https://app.example")).toBe(false);
  });
});

describe("delivery", () => {
  it("emails each notification once", async () => {
    const sim = await world();
    await sim.store.notify({ businessId: "b1", kind: "low_balance", message: "Пополните баланс", at: sim.clock.now() });
    const mailer = new CapturingMailer();
    expect(await deliverNotifications(sim.ctx, mailer, createLogger(() => undefined))).toBe(1);
    expect(await deliverNotifications(sim.ctx, mailer, createLogger(() => undefined))).toBe(0);
    expect(mailer.sent[0]).toMatchObject({ to: "owner@example.com", subject: "Пополните баланс в Яндекс Директе" });
  });

  it("delivers to a real SMTP test inbox (Mailpit)", async () => {
    const sim = await world();
    const marker = `Проверка ${Date.now()}`;
    await sim.store.notify({ businessId: "b1", kind: "budget_80", message: marker, at: sim.clock.now() });
    await deliverNotifications(sim.ctx, new SmtpMailer(MAILPIT_SMTP, "Импульс <noreply@impuls.test>"), createLogger(() => undefined));
    const response = await fetch(`${MAILPIT_API}/api/v1/search?query=${encodeURIComponent(marker)}`);
    const body = (await response.json()) as { messages: { Subject: string; To: { Address: string }[] }[] };
    expect(body.messages[0]).toMatchObject({ Subject: "Израсходовано 80% бюджета месяца", To: [{ Address: "owner@example.com" }] });
  });
});
