import { createPool, databaseUrl } from "@impuls/db";
import { afterAll, describe, expect, it } from "vitest";
import { PgLockManager } from "./pg-locks";

// Requires the compose PostgreSQL: DATABASE_URL=postgres://impuls:impuls@localhost:54329/impuls
const workerA = createPool(databaseUrl());
const workerB = createPool(databaseUrl());

afterAll(async () => {
  await Promise.all([workerA.end(), workerB.end()]);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("PgLockManager", () => {
  it("serializes work on one business across two workers", async () => {
    const locksA = new PgLockManager(workerA);
    const locksB = new PgLockManager(workerB);
    const events: string[] = [];
    const job = (locks: PgLockManager, name: string) =>
      locks.withLock("business:b1", async () => {
        events.push(`${name}:start`);
        await sleep(100);
        events.push(`${name}:end`);
      });
    await Promise.all([job(locksA, "A"), job(locksB, "B")]);
    expect([events.slice(0, 2), events.slice(2)].every(([s, e]) => s?.endsWith(":start") && e?.endsWith(":end") && s.split(":")[0] === e.split(":")[0])).toBe(true);
  });

  it("lets different businesses run in parallel", async () => {
    const locksA = new PgLockManager(workerA);
    const locksB = new PgLockManager(workerB);
    const started = Date.now();
    await Promise.all([locksA.withLock("business:b1", () => sleep(150)), locksB.withLock("business:b2", () => sleep(150))]);
    expect(Date.now() - started).toBeLessThan(290);
  });

  it("skips a second agent turn while one is running", async () => {
    const locksA = new PgLockManager(workerA);
    const locksB = new PgLockManager(workerB);
    let second: string | null = "not run";
    await locksA.withLock("turn:b1", async () => {
      second = await locksB.tryWithLock("turn:b1", () => Promise.resolve("ran"));
    });
    expect(second).toBeNull();
  });
});
