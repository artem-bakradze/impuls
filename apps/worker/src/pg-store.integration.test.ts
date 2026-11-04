import { AdversarialPolicy, IdlePolicy } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { createDb, createPool, databaseUrl, schema, sql } from "@impuls/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExecutionResult } from "./executor";
import { rollback } from "./history";
import { PgLockManager } from "./pg-locks";
import { PgStore } from "./pg-store";
import { SimulationDriver } from "./simulation";

// Requires the compose PostgreSQL with migrations applied (pnpm db:migrate).
const pool = createPool(databaseUrl());
const db = createDb(pool);

beforeAll(async () => {
  await db.execute(sql`TRUNCATE users, businesses, campaigns, ads, change_log, stats_daily, user_decisions, sync_cursors,
    evaluations, experiments, agent_turns, runtime_flags, heartbeats, incidents, notifications CASCADE`);
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
    // The agent is called on reasons: in a first week of collecting data, the Monday review at least.
    const turns = await store.turns("b1");
    expect(turns.length).toBeGreaterThanOrEqual(1);
    // The quiet mornings are marked, and the evaluation keeps its findings for the next day's reasons.
    expect((await store.insights("b1")).some((i) => i.reasonCode === "QUIET_DAY")).toBe(true);
    expect(Array.isArray((await store.lastEvaluation("b1"))?.findings)).toBe(true);
    // The feed's light view of the journal and the pult's running turn.
    expect(await store.turnDigests("b1")).toEqual(
      turns.map((t) => ({ id: t.id, trigger: t.trigger, status: t.status, startedAt: t.startedAt, summary: t.summary, summaryValid: t.summaryValid, usageSource: t.usageSource })),
    );
    expect(await store.runningTurn("b1")).toBeNull();
    const last = turns.at(-1);
    if (!last) throw new Error("no turns");
    await store.saveTurn({ ...last, id: "turn-running", status: "running", startedAt: new Date("2026-10-08T03:00:00Z") });
    expect(await store.runningTurn("b1")).toEqual({ startedAt: new Date("2026-10-08T03:00:00Z"), trigger: last.trigger });
    expect(await store.lastBeat("budget_guard")).not.toBeNull();
    const ids = (await store.directions("b1")).map((d) => d.platformCampaignId);
    expect(sim.platform.trueSpend(ids, "2026-10-01", "2026-10-31")).toBeLessThanOrEqual(rubles(9_000));
  });

  it("keeps a simulation and deletes everything the launch created", async () => {
    const store = new PgStore(db);
    const business = await store.getBusiness("b1");
    expect(business.mode).toBe("direct");
    await store.saveBusiness({ ...business, mode: "simulation" });
    const at = new Date("2026-10-08T00:00:00Z");
    const state = { campaigns: [], settings: [], ads: [], landingUrls: [], truths: [], cells: [], changes: [], weekSpend: [], rng: 42, nextId: 7, balance: 1_000 };
    const simulation = {
      businessId: "b1",
      scenario: "regular",
      seed: 9,
      plan: { landingUrl: "https://nogotok.example", city: "Москва", directions: [] },
      startedAt: at,
      simNow: at,
      endsAt: new Date("2026-10-31T00:00:00Z"),
      lastTickAt: null,
      speed: 8_640,
      status: "stepping" as const,
      state,
      baseline: null,
      steps: [{ kind: "week" as const, from: at, to: new Date("2026-10-08T00:00:00Z") }],
      replay: null,
    };
    await store.saveSimulation(simulation);
    expect((await store.getBusiness("b1")).mode).toBe("simulation");
    expect(await store.getSimulation("b1")).toEqual(simulation);
    await store.saveSimulation({ ...simulation, status: "paused" });
    expect((await store.getSimulation("b1"))?.status).toBe("paused");

    // Analyst settings of a direction and the hypothesis journal (add-agent-analyst-stage1).
    const [direction] = await store.directions("b1");
    if (!direction) throw new Error("no direction");
    expect(direction).toMatchObject({ keywords: ["маникюр — поиск"], negativeKeywords: [], deviceAdjustments: { mobile: 0, desktop: 0 }, deviceAdjustedOn: { mobile: null, desktop: null } });
    const analyst = { negativeKeywords: ["бесплатно"], deviceAdjustments: { mobile: -25, desktop: 0 }, deviceAdjustedOn: { mobile: "2026-10-08", desktop: null } };
    await store.saveDirection({ ...direction, ...analyst });
    expect((await store.directions("b1"))[0]).toMatchObject(analyst);
    const fact = { key: "segment:d1:device:mobile:cost_per_lead:14d", object: "телефоны", metric: "cost_per_lead" as const, period: "14d" as const, value: 1_100, unit: "rub" as const };
    const hypothesis = {
      id: "hyp-1",
      businessId: "b1",
      openedTurnId: "turn-1",
      closedTurnId: null,
      statement: "С телефонов клиенты обходятся дороже",
      facts: [fact],
      check: "Сравним цену обращения через 7 дней",
      checkOn: "2026-10-15",
      status: "checking" as const,
      result: null,
      resultFacts: [],
      openedAt: at,
      closedAt: null,
    };
    await store.saveHypothesis(hypothesis);
    const closed = { ...hypothesis, status: "confirmed" as const, closedTurnId: "turn-2", result: "Обращение подешевело", resultFacts: [fact], closedAt: new Date("2026-10-15T04:00:00Z") };
    await store.saveHypothesis(closed);
    expect(await store.hypotheses("b1")).toEqual([closed]);

    await store.deleteLaunchData("b1");
    expect(await store.hypotheses("b1")).toEqual([]);
    expect(await store.directions("b1")).toEqual([]);
    expect(await store.ads("b1")).toEqual([]);
    expect(await store.changes("b1")).toEqual([]);
    expect(await store.stats("b1", "2026-10-01", "2026-10-31")).toEqual([]);
    expect(await store.turns("b1")).toEqual([]);
    await store.deleteSimulation("b1");
    expect(await store.getSimulation("b1")).toBeNull();
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

describe("the journal's order on PostgreSQL (change-history spec «Порядок записей истории»)", () => {
  const entryOf = (result: ExecutionResult): string => {
    if (result.status !== "applied" && result.status !== "clamped") throw new Error(`not applied: ${result.message}`);
    return result.entryId;
  };

  // Where PostgreSQL puts a row is not the order of writing; the next test pins that down deterministically.
  it("takes the owner's change back at once when the agent's change of the same limit has the same virtual time", async () => {
    await db.insert(schema.users).values({ id: "user-b2", googleSub: "sub-b2", email: "owner2@example.com", name: "Владелец" });
    const store = new PgStore(db);
    const sim = new SimulationDriver({ start: new Date("2026-11-02T00:00:00Z"), seed: 3, agent: new IdlePolicy(), store, locks: new PgLockManager(pool) });
    const truth = { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) };
    await sim.launchBusiness({
      id: "b2",
      monthlyBudgetRub: 9_000,
      launchedOn: "2026-11-02",
      csoSource: { kind: "user", goal: rubles(800) },
      directions: [{ name: "Маникюр — Сайты-партнёры", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth }] }],
    });
    await sim.runDays(1);
    const [direction] = await store.directions("b2");
    if (!direction) throw new Error("no direction");

    // Lowering is open to the agent; the limit is already cut to the month by the budget guard, so it starts from there.
    const agentLimit = direction.weeklyLimit - rubles(100);
    // The virtual clock stands between steps: the agent's change and the owner's one after it get the same time.
    const agent = entryOf(
      await sim.ctx.executor.execute({ businessId: "b2", command: { type: "SetSpendLimit", directionId: direction.id, weeklyLimit: agentLimit }, actor: "agent", reasonCode: "SCALE_EFFECTIVE", explanation: "Снизил лимит." }),
    );
    const owner = entryOf(
      await sim.ctx.executor.execute({ businessId: "b2", command: { type: "SetSpendLimit", directionId: direction.id, weeklyLimit: agentLimit - rubles(100) }, actor: "user", reasonCode: "USER_CHANGE", explanation: "Вы снизили лимит." }),
    );
    const pair = (await store.changes("b2")).filter((c) => c.id === agent || c.id === owner);
    expect(new Set(pair.map((c) => c.createdAt.getTime())).size).toBe(1);
    expect(pair.map((c) => c.id)).toEqual([agent, owner]);

    // Nothing of the same limit was written after the owner's change, so it goes back without a chain.
    expect(await rollback(sim.ctx, { businessId: "b2", entryId: owner })).toMatchObject({ kind: "done" });
    expect((await store.directions("b2"))[0]?.weeklyLimit).toBe(agentLimit);
  });

  it("keeps the order of writing when the later of two entries of one time is applied first", async () => {
    const store = new PgStore(db);
    const [sample] = await store.changes("b2");
    if (!sample) throw new Error("no change");
    const at = new Date("2026-11-20T07:00:00Z");
    const entry = (explanation: string) => ({
      businessId: "b2",
      actor: sample.actor,
      author: sample.author,
      action: sample.action,
      objectKind: sample.objectKind,
      objectId: "tie",
      before: sample.before,
      after: sample.after,
      status: "pending" as const,
      reasonCode: sample.reasonCode,
      explanation,
      turnId: null,
      createdAt: at,
      error: null,
      revertedById: null,
      outcome: null,
    });
    const first = await store.appendChange(entry("первое"));
    const second = await store.appendChange(entry("второе"));
    await store.updateChange(second.id, { status: "applied" });
    await store.updateChange(first.id, { status: "applied" });
    expect((await store.changes("b2")).filter((c) => c.objectId === "tie").map((c) => c.explanation)).toEqual(["первое", "второе"]);
  });
});
