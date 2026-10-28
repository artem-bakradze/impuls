import { AdversarialPolicy } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { createDb, createPool, databaseUrl, schema, sql } from "@impuls/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgLockManager } from "./pg-locks";
import { PgStore } from "./pg-store";
import { SimulationDriver } from "./simulation";

// Requires the compose PostgreSQL with migrations applied (pnpm db:migrate).
const pool = createPool(databaseUrl());
const db = createDb(pool);

beforeAll(async () => {
  await db.execute(sql`TRUNCATE users, businesses, campaigns, ads, change_log, stats_daily, user_decisions, sync_cursors,
    evaluations, experiments, agent_turns, agent_notes, runtime_flags, heartbeats, incidents, notifications CASCADE`);
  await db.insert(schema.users).values({ id: "user-b1", googleSub: "sub-b1", email: "owner@example.com", name: "Владелец" });
});

afterAll(async () => {
  await pool.end();
});

describe("PgStore with the full worker loop", () => {
  it("runs a week of simulation on PostgreSQL: budget kept, changes and turns persisted", async () => {
    const store = new PgStore(db);
    const sim = new SimulationDriver({
      start: new Date("2026-10-01T00:00:00Z"),
      seed: 9,
      agent: new AdversarialPolicy(),
      store,
      locks: new PgLockManager(pool),
    });
    const truth = { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) };
    await sim.launchBusiness({
      id: "b1",
      monthlyBudgetRub: 9_000,
      launchedOn: "2026-10-01",
      csoSource: { kind: "user", goal: rubles(800) },
      directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth }] }],
    });
    await sim.runDays(7);

    const changes = await store.changes("b1");
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((c) => c.status !== "pending")).toBe(true);
    expect((await store.turns("b1")).length).toBeGreaterThanOrEqual(6);
    expect(await store.lastBeat("budget_guard")).not.toBeNull();
    const ids = (await store.directions("b1")).map((d) => d.platformCampaignId);
    expect(sim.platform.trueSpend(ids, "2026-10-01", "2026-10-31")).toBeLessThanOrEqual(rubles(9_000));
  });

  it("stores kill switches globally and per business", async () => {
    const store = new PgStore(db);
    await store.setFlag("agent_enabled", false, "b1");
    expect(await store.getFlag("agent_enabled", "b1")).toBe(false);
    expect(await store.getFlag("agent_enabled", "other")).toBe(true);
    await store.setFlag("agent_enabled", false, null);
    expect(await store.getFlag("agent_enabled", "other")).toBe(false);
    await store.setFlag("agent_enabled", true, null);
  });
});
