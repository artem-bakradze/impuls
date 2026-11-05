import { IdlePolicy, TemplateCreativeEngine, TemplateImageEngine } from "@impuls/agent";
import { createDb, createPool, databaseUrl, schema } from "@impuls/db";
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
import type { WebJob } from "./web-jobs";

const pool = createPool(databaseUrl());
const db = createDb(pool);
const store = new PgStore(db);
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
      creatives: new TemplateCreativeEngine(),
      images: new TemplateImageEngine(),
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

  it("the ops CLI switches automation off for one business", async () => {
    const lines: string[] = [];
    const send = () => Promise.reject(new Error("no jobs expected"));
    await runCli(["flags", "set", "automation_enabled", "off", "--business", "cli-b1"], store, send, createLogger((l) => lines.push(l)));
    expect(await store.getFlag("automation_enabled", "cli-b1")).toBe(false);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ message: "Kill switch changed", flag: "automation_enabled", enabled: false });
    await expect(runCli(["flags", "set", "unknown", "off"], store, send)).rejects.toThrow("Usage");
    await runCli(["flags", "set", "automation_enabled", "on", "--business", "cli-b1"], store, send, createLogger(() => undefined));
  });

  it("the ops CLI queues account deletion to the worker only for an existing business", async () => {
    const sent: WebJob[] = [];
    const send = (job: WebJob) => {
      sent.push(job);
      return Promise.resolve("job-1");
    };
    await expect(runCli(["account", "delete", "no-such-business"], store, send, createLogger(() => undefined))).rejects.toThrow();
    expect(sent).toEqual([]);
    await db.insert(schema.users).values({ id: "user-cli-b1", googleSub: "sub-cli-b1", kind: "google", email: "cli@example.com", name: "Владелец" }).onConflictDoNothing();
    await store.saveBusiness({
      id: "cli-b1",
      userId: "user-cli-b1",
      timeZone: "Europe/Moscow",
      monthlyBudgetRub: 10_000,
      launchedOn: null,
      csoSource: { kind: "auto", reference: 100_000 },
      miniSite: null,
      leadGoalId: null,
      mode: "direct",
      card: { category: "Студия", services: [], area: "", hours: "10:00–20:00", advantages: [], name: "Студия", address: "Москва", city: "Москва", siteUrl: "https://example.com/" },
    });
    await runCli(["account", "delete", "cli-b1"], store, send, createLogger(() => undefined));
    expect(sent).toEqual([{ kind: "delete_account", businessId: "cli-b1" }]);
  });

  it("the ops CLI shows the agent's model spend of the month per business", async () => {
    const send = () => Promise.reject(new Error("no jobs expected"));
    const turn = (id: string, startedAt: Date, costKopecks: number) => ({
      id,
      businessId: "cli-b1",
      trigger: "daily_review",
      runtime: "openai",
      instructionsVersion: "test",
      startedAt,
      finishedAt: startedAt,
      status: "completed" as const,
      context: {},
      calls: [],
      summary: null,
      summaryValid: false,
      inputTokens: 1_000,
      outputTokens: 100,
      usageSource: "estimate" as const,
      costKopecks,
    });
    await store.saveTurn(turn("cli-turn-1", new Date("2026-09-30T22:00:00Z"), 1_250));
    await store.saveTurn(turn("cli-turn-2", new Date("2026-09-30T12:00:00Z"), 990));
    const lines: string[] = [];
    await runCli(["agent", "costs", "--month", "2026-10"], store, send, createLogger((l) => lines.push(l)));
    // 22:00 UTC on 30 September is already 1 October in Moscow.
    expect(lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.businessId === "cli-b1")).toMatchObject({
      message: "Agent costs",
      period: "2026-10",
      turns: 1,
      estimatedTurns: 1,
      costRub: 12.5,
      paidPictures: 0,
    });
    await expect(runCli(["agent", "costs", "--month", "октябрь"], store, send)).rejects.toThrow("Usage");
  });
});
