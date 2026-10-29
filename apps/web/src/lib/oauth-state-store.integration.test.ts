import { randomUUID } from "node:crypto";
import { createDb, createPool } from "@impuls/db";
import { afterAll, describe, expect, it } from "vitest";
import { createOAuthStateStore } from "./oauth-state-store";

const pool = createPool();
const states = createOAuthStateStore(createDb(pool));

afterAll(async () => {
  await pool.end();
});

describe("OAuth state store (PostgreSQL)", () => {
  const now = new Date("2026-10-29T10:00:00Z");

  it("accepts a state once, only for its user and before it expires", async () => {
    const state = randomUUID();
    await states.save({ state, userId: "u1", expiresAt: new Date(now.getTime() + 600_000) });
    expect(await states.consume(state, "u2", now)).toBe(false);
    // A wrong user does not burn the state for the right one.
    expect(await states.consume(state, "u1", now)).toBe(true);
    expect(await states.consume(state, "u1", now)).toBe(false);
  });

  it("refuses an expired state", async () => {
    const state = randomUUID();
    await states.save({ state, userId: "u1", expiresAt: new Date(now.getTime() - 1) });
    expect(await states.consume(state, "u1", now)).toBe(false);
  });
});
