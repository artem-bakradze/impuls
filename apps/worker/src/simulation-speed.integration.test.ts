import { IdlePolicy, TemplateCreativeEngine, TemplateImageEngine } from "@impuls/agent";
import { allowedWeeklyTotal, monthBudget, rubles, toLocalDate } from "@impuls/core";
import { createDb, createPool, databaseUrl, schema, sql } from "@impuls/db";
import { afterAll, describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import type { JobContext } from "./context";
import { CommandExecutor } from "./executor";
import { PgLockManager } from "./pg-locks";
import { PgStore } from "./pg-store";
import { controlSimulation, launchSimulation } from "./simulation-mode";

// Requires the compose PostgreSQL with migrations applied (pnpm db:migrate).
const pool = createPool(databaseUrl());
const db = createDb(pool);

afterAll(async () => {
  await pool.end();
});

/** A period of the owner's numbers on the real store: the step, its numbers and a run without a scenario are kept. */
describe("simulation period on PostgreSQL", () => {
  it("records two weeks of the owner's numbers and reviews them within 30 seconds", async () => {
    await db.execute(sql`DELETE FROM simulations WHERE business_id = 'speed-b1'`);
    await db.execute(sql`DELETE FROM users WHERE id = 'speed-u1'`).catch(() => undefined);
    const store = new PgStore(db);
    await db.insert(schema.users).values({ id: "speed-u1", googleSub: "speed-sub", kind: "google", email: "speed@example.com", name: null }).onConflictDoNothing();
    await store.saveBusiness({
      id: "speed-b1",
      userId: "speed-u1",
      timeZone: "Europe/Moscow",
      monthlyBudgetRub: 15_000,
      launchedOn: null,
      csoSource: { kind: "auto", reference: rubles(500) },
      miniSite: null,
      leadGoalId: null,
      mode: "direct",
      card: { category: "Маникюр", services: [], area: "", hours: "Пн–Вс 10:00–20:00", advantages: [], name: "", address: "", city: "Москва", siteUrl: "https://nogotok.example" },
    });
    await store.deleteLaunchData("speed-b1");
    const real = new ManualClock(new Date("2026-11-03T07:00:00Z"));
    const locks = new PgLockManager(pool);
    const platformFor = () => {
      throw new Error("no Direct in a simulation");
    };
    const ctx: JobContext = { store, clock: real, locks, executor: new CommandExecutor({ store, locks, clock: real, platformFor }), platformFor, agent: new IdlePolicy(), creatives: new TemplateCreativeEngine(), images: new TemplateImageEngine() };
    const today = toLocalDate(real.now(), "Europe/Moscow");
    const total = Math.floor(allowedWeeklyTotal(0, monthBudget(15_000, today, today), today) / 100);
    await launchSimulation(
      ctx,
      "speed-b1",
      {
        landingUrl: "https://nogotok.example",
        city: "Москва",
        directions: [
          { name: "Маникюр — Поиск", channel: "search", weeklyLimitRub: Math.floor(total * 0.6), keywords: ["маникюр"], negativeKeywords: [], ads: [1, 2, 3].map((i) => ({ title: `Маникюр ${i}`, text: "У метро" })) },
          { name: "Маникюр — Сайты-партнёры", channel: "network", weeklyLimitRub: total - Math.floor(total * 0.6), keywords: [], negativeKeywords: [], ads: [1, 2, 3].map((i) => ({ title: `Ноготок ${i}`, text: "Онлайн" })) },
        ],
      },
    );
    const [ad] = (await store.ads("speed-b1")).filter((a) => a.title === "Маникюр 1");
    const input = [{ adId: ad?.id ?? "", impressions: 2_000, clicks: 90, leads: 4, spendRub: 1_200 }];
    const started = Date.now();
    await controlSimulation(ctx, "speed-b1", { action: "period", days: 14, ads: input });
    const elapsed = (Date.now() - started) / 1_000;
    const simulation = await store.getSimulation("speed-b1");
    console.log(`A period of 14 virtual days took ${elapsed.toFixed(1)} s of work`);
    expect(simulation).toMatchObject({ scenario: null, status: "paused", steps: [{ kind: "period", days: 14, input, recorded: true, state: "completed" }] });
    const rows = await store.stats("speed-b1", "2026-11-01", "2026-12-31");
    expect(rows.filter((r) => r.adId === ad?.platformAdId).reduce((s, r) => s + r.spend, 0)).toBe(120_000);
    expect(elapsed).toBeLessThan(30);
  }, 120_000);
});
