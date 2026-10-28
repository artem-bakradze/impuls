import { IdlePolicy } from "@impuls/agent";
import { createDb, createPool, databaseUrl } from "@impuls/db";
import { PgBoss } from "pg-boss";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "./cli";
import { systemClock } from "./clock";
import { CommandExecutor } from "./executor";
import { createLogger } from "./logger";
import { PgLockManager } from "./pg-locks";
import { PgStore } from "./pg-store";
import { DISPATCH_QUEUE, startScheduler } from "./scheduler";
import { SimulatedPlatform } from "@impuls/platforms";

const pool = createPool(databaseUrl());
const store = new PgStore(createDb(pool));
const boss = new PgBoss(databaseUrl());

afterAll(async () => {
  await boss.stop({ graceful: false });
  await pool.end();
});

describe("pg-boss scheduler", () => {
  it("runs the hourly dispatcher job and records its heartbeat", async () => {
    const platform = new SimulatedPlatform({ seed: 1, timeZone: "UTC", now: () => new Date(), truthFor: () => ({ impressionsPerDay: 1, ctr: 0, cr: 0, costPerClick: 1 }) });
    const locks = new PgLockManager(pool);
    const ctx = {
      store,
      clock: systemClock,
      locks,
      executor: new CommandExecutor({ store, locks, clock: systemClock, platformFor: () => platform }),
      platformFor: () => platform,
      agent: new IdlePolicy(),
    };
    await boss.start();
    await startScheduler(boss, ctx, createLogger(() => undefined));
    const before = (await store.lastBeat("dispatcher"))?.getTime() ?? 0;
    await boss.send(DISPATCH_QUEUE, {});
    let after = before;
    for (let i = 0; i < 50 && after <= before; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      after = (await store.lastBeat("dispatcher"))?.getTime() ?? 0;
    }
    expect(after).toBeGreaterThan(before);
  });

  it("the ops CLI switches the agent off for one business", async () => {
    const lines: string[] = [];
    await runCli(["flags", "set", "agent_enabled", "off", "--business", "cli-b1"], store, createLogger((l) => lines.push(l)));
    expect(await store.getFlag("agent_enabled", "cli-b1")).toBe(false);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ message: "Kill switch changed", flag: "agent_enabled", enabled: false });
    await expect(runCli(["flags", "set", "unknown", "off"], store)).rejects.toThrow("Usage");
    await runCli(["flags", "set", "agent_enabled", "on", "--business", "cli-b1"], store, createLogger(() => undefined));
  });
});
