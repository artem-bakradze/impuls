import { AdversarialPolicy, IdlePolicy, RandomPolicy } from "@impuls/agent";
import { JARGON_STOP_LIST, rubles } from "@impuls/core";
import { describe, expect, it } from "vitest";
import { businessesDueForDaily } from "./dispatcher";
import { checkHealth } from "./monitoring";
import { SimulationDriver } from "./simulation";
import { renderTemplate, sampleFacts, templateCodes } from "./templates";

const good = { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) };
const bad = { impressionsPerDay: 800, ctr: 0.06, cr: 0.0, costPerClick: rubles(30) };

const launch = async (sim: SimulationDriver, budgetRub = 30_000) =>
  sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: budgetRub,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [
      { name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth: good }, { title: "Маникюр без записи", truth: bad }] },
      { name: "Педикюр — Поиск", weeklyLimitRub: 1_500, ads: [{ title: "Педикюр", truth: good }] },
    ],
  });

const campaignIds = async (sim: SimulationDriver) => (await sim.store.directions("b1")).map((d) => d.platformCampaignId);

describe("SimulationDriver", () => {
  it("simulates 30 days in well under a minute and is reproducible for a seed", async () => {
    const run = async () => {
      const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 7, agent: new IdlePolicy() });
      await launch(sim);
      await sim.runDays(30);
      return { spend: sim.platform.trueSpend(await campaignIds(sim), "2026-10-01", "2026-10-31"), changes: (await sim.store.changes("b1")).map((c) => c.reasonCode) };
    };
    const started = Date.now();
    const first = await run();
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(await run()).toEqual(first);
  });

  it("the safety net pauses an ad without leads within 14 days when the agent does nothing", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 3, agent: new IdlePolicy() });
    await launch(sim);
    await sim.runDays(14);
    const badAd = (await sim.store.ads("b1")).find((a) => a.title === "Маникюр без записи");
    expect(badAd?.status).toBe("paused");
    const entry = (await sim.store.changes("b1")).find((c) => c.objectId === badAd?.id);
    expect(entry).toMatchObject({ actor: "safety_net", reasonCode: "SAFETY_PAUSE_AD", status: "applied" });
  });

  it("never exceeds the month budget with an adversarial agent and a 48-hour worker outage", async () => {
    for (const seed of [11, 12, 13]) {
      const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed, agent: new AdversarialPolicy() });
      await launch(sim, 9_000);
      const outageStart = new Date("2026-10-10T00:00:00Z").getTime();
      await sim.runDays(31, { workerDown: (at) => at.getTime() >= outageStart && at.getTime() < outageStart + 48 * 3_600_000 });
      const spent = sim.platform.trueSpend(await campaignIds(sim), "2026-10-01", "2026-10-31");
      expect(spent).toBeLessThanOrEqual(rubles(9_000));
    }
  });

  it("random agent policies cannot break the budget either", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 21, agent: new RandomPolicy(21) });
    await launch(sim, 6_000);
    await sim.runDays(31);
    expect(sim.platform.trueSpend(await campaignIds(sim), "2026-10-01", "2026-10-31")).toBeLessThanOrEqual(rubles(6_000));
  });

  it("adversarial calls on foreign objects are rejected and logged in the turn journal", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 5, agent: new AdversarialPolicy() });
    await launch(sim);
    await sim.runDays(2);
    const turn = (await sim.store.turns("b1"))[0];
    const calls = turn?.calls as { command: { adId?: string }; result: { status: string; code?: string } }[];
    expect(calls.find((c) => c.command.adId === "foreign-ad")?.result).toMatchObject({ status: "rejected", code: "OBJECT_NOT_FOUND" });
  });
});

describe("dispatcher", () => {
  it("schedules 06:00 local jobs per time zone", () => {
    const at = new Date("2026-10-28T01:00:00Z");
    expect(businessesDueForDaily([{ id: "ekb", timeZone: "Asia/Yekaterinburg" }, { id: "msk", timeZone: "Europe/Moscow" }], at)).toEqual(["ekb"]);
  });
});

describe("explanation templates", () => {
  it("contain no jargon", () => {
    for (const code of templateCodes()) {
      const text = renderTemplate(code, sampleFacts).toLowerCase();
      for (const word of JARGON_STOP_LIST) {
        expect(text, `${code} contains ${word}`).not.toContain(word);
      }
    }
  });
});

describe("monitoring", () => {
  it("reports stale heartbeats and opens an incident", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 1, agent: new IdlePolicy() });
    await launch(sim);
    await sim.runHours(1);
    expect((await checkHealth(sim.store, sim.clock)).ok).toBe(true);
    sim.clock.advanceHours(3);
    const report = await checkHealth(sim.store, sim.clock);
    expect(report.stale).toContain("budget_guard");
    expect((await sim.store.incidents()).some((i) => i.kind === "heartbeat_stale")).toBe(true);
  });

  it("a switched-off agent flag stops new turns for that business", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 1, agent: new AdversarialPolicy() });
    await launch(sim);
    await sim.store.setFlag("agent_enabled", false, "b1");
    await sim.runDays(2);
    expect(await sim.store.turns("b1")).toHaveLength(0);
  });
});
