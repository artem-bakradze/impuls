import { IdlePolicy, TemplateCreativeEngine } from "@impuls/agent";
import { allowedWeeklyTotal, monthBudget, rubles, toLocalDate } from "@impuls/core";
import { createDb, createPool, databaseUrl, schema, sql } from "@impuls/db";
import { afterAll, describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import type { JobContext } from "./context";
import { CommandExecutor } from "./executor";
import { createLogger } from "./logger";
import { PgLockManager } from "./pg-locks";
import { PgStore } from "./pg-store";
import { controlSimulation, launchSimulation, tickSimulations } from "./simulation-mode";

// Requires the compose PostgreSQL with migrations applied (pnpm db:migrate).
const pool = createPool(databaseUrl());
const db = createDb(pool);

afterAll(async () => {
  await pool.end();
});

/** simulation-mode spec: at «1 день = 10 секунд» 30 virtual days take at most 6 minutes on the real store. */
describe("simulation speed on PostgreSQL", () => {
  it("runs 30 days of «Пограничное объявление» at the fast speed within 6 minutes", async () => {
    await db.execute(sql`DELETE FROM simulations WHERE business_id = 'speed-b1'`);
    await db.execute(sql`DELETE FROM users WHERE id = 'speed-u1'`).catch(() => undefined);
    const store = new PgStore(db);
    await db.insert(schema.users).values({ id: "speed-u1", googleSub: "speed-sub", email: "speed@example.com", name: null }).onConflictDoNothing();
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
    const ctx: JobContext = { store, clock: real, locks, executor: new CommandExecutor({ store, locks, clock: real, platformFor }), platformFor, agent: new IdlePolicy(), creatives: new TemplateCreativeEngine() };
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
      "borderline",
    );
    await controlSimulation(ctx, "speed-b1", { action: "speed", speed: "fast" });
    const logger = createLogger(() => undefined);
    const started = Date.now();
    // Real seconds of the ticker; each tick does the work of one second at «1 день = 10 секунд».
    for (let second = 0; second < 400 && (await store.getSimulation("speed-b1"))?.status !== "paused"; second++) {
      real.set(new Date(real.now().getTime() + 1_000));
      await tickSimulations(ctx, logger);
    }
    const elapsed = (Date.now() - started) / 1_000;
    const simulation = await store.getSimulation("speed-b1");
    console.log(`30 virtual days took ${elapsed.toFixed(1)} s of work`);
    expect(simulation?.status).toBe("paused");
    expect(simulation?.baseline?.days).toBe(30);
    // The ticker's own pace is 300 s for 30 days; the work must fit into it with room to spare.
    expect(elapsed).toBeLessThan(300);
  }, 600_000);
});
