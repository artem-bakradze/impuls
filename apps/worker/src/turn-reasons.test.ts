import { QuietPolicy } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { describe, expect, it } from "vitest";
import { QUIET_DAY_CODE, RULES_DAY_CODE } from "./change-kinds";
import { SimulationDriver } from "./simulation";

const good = { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) };
const bad = { impressionsPerDay: 800, ctr: 0.06, cr: 0, costPerClick: rubles(30) };

/** «Маникюр без записи» spends without leads; the agent takes its turns and changes nothing. */
const world = async () => {
  // 2026-10-01 is a Thursday.
  const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 8, agent: new QuietPolicy() });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: 30_000,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth: good }, { title: "Маникюр без записи", truth: bad }] }],
  });
  return sim;
};

const dailyTurns = async (sim: SimulationDriver) => (await sim.store.turns("b1")).filter((t) => t.trigger === "daily_review");

describe("agent turns on reasons (ad-agent «Поводы для хода агента»)", () => {
  it("calls no model on days without reasons and shows them as quiet, not as days of the rules", async () => {
    const sim = await world();
    await sim.runDays(4);
    expect(await dailyTurns(sim)).toEqual([]);
    const insights = await sim.store.insights("b1");
    expect(insights.filter((i) => i.reasonCode === QUIET_DAY_CODE)).toHaveLength(4);
    expect(insights.filter((i) => i.reasonCode === RULES_DAY_CODE)).toEqual([]);
    // Nothing was decided without the agent: no ad was paused and no check was started «без ожидания агента».
    expect((await sim.store.changes("b1")).filter((c) => c.actor === "safety_net")).toEqual([]);
  });

  it("runs a turn when an ad becomes ineffective, and the rules pause it a day after if the agent left it", async () => {
    const sim = await world();
    await sim.runDays(20);
    const turns = await dailyTurns(sim);
    const reasonTurn = turns.find((t) =>
      ((t.context as { trigger: { reasons?: { kind: string }[] } }).trigger.reasons ?? []).some((r) => r.kind === "became_ineffective"),
    );
    expect(reasonTurn).toBeDefined();
    const deadAd = (await sim.store.ads("b1")).find((a) => a.title === "Маникюр без записи");
    expect(deadAd?.status).toBe("paused");
    const pause = (await sim.store.changes("b1")).find((c) => c.objectId === deadAd?.id && c.action.type === "PauseAd");
    expect(pause?.actor).toBe("safety_net");
    // The agent had its 24 hours: the pause comes the morning after the turn, not on the same day.
    const waited = (pause?.createdAt.getTime() ?? 0) - (reasonTurn?.startedAt.getTime() ?? 0);
    expect(waited).toBeGreaterThanOrEqual(23 * 3_600_000);
    // A finding the last turn saw gives no reason again: one turn for the dead ad, not one every day.
    expect(turns.filter((t) => ((t.context as { trigger: { reasons?: { kind: string; objectId: string }[] } }).trigger.reasons ?? []).some((r) => r.kind === "became_ineffective" && r.objectId === deadAd?.id))).toHaveLength(1);
    expect((await sim.store.insights("b1")).filter((i) => i.reasonCode === RULES_DAY_CODE)).toEqual([]);
  });
});
