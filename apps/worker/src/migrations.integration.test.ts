import { createDb, createPool, databaseUrl } from "@impuls/db";
import { migrateToLatest } from "@impuls/db/migrate";
import { describe, expect, it } from "vitest";
import { PgStore } from "./pg-store";

/** Migrates a throwaway database from scratch: what a new deployment gets (add-agent-insights decision 6). */
describe("migrations on an empty database", () => {
  it("start with the agent and automation switched on globally and no insights", async () => {
    const admin = createPool(databaseUrl());
    const name = `impuls_fresh_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl());
    url.pathname = `/${name}`;
    const pool = createPool(url.toString());
    try {
      const db = createDb(pool);
      await migrateToLatest(db);
      const store = new PgStore(db);
      expect(await store.getFlag("agent_enabled", null)).toBe(true);
      expect(await store.getFlag("agent_enabled", "any-business")).toBe(true);
      expect(await store.getFlag("automation_enabled", "any-business")).toBe(true);
      expect(await store.getSimulation("any-business")).toBeNull();
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    }
  });
});
