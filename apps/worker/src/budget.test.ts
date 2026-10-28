import { AdversarialPolicy, IdlePolicy } from "@impuls/agent";
import { createRng, rubles } from "@impuls/core";
import { describe, expect, it } from "vitest";
import { changeBudget, previewBudgetChange } from "./budget-settings";
import { verifyBudget } from "./jobs";
import { SimulationDriver } from "./simulation";

const truth = { impressionsPerDay: 900, ctr: 0.06, cr: 0.08, costPerClick: rubles(25) };

const world = async (budgetRub: number, options: { seed?: number; agent?: SimulationDriver["ctx"]["agent"]; start?: string } = {}) => {
  const sim = new SimulationDriver({ start: new Date(options.start ?? "2026-10-01T00:00:00Z"), seed: options.seed ?? 4, agent: options.agent ?? new IdlePolicy() });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: budgetRub,
    launchedOn: (options.start ?? "2026-10-01").slice(0, 10),
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [
      { name: "Маникюр — Поиск", weeklyLimitRub: 4_000, ads: [{ title: "Маникюр у метро", truth }] },
      { name: "Педикюр — Поиск", weeklyLimitRub: 3_000, ads: [{ title: "Педикюр", truth }] },
    ],
  });
  return sim;
};

const spentRub = async (sim: SimulationDriver, from: string, to: string) =>
  sim.platform.trueSpend((await sim.store.directions("b1")).map((d) => d.platformCampaignId), from, to) / 100;

describe("budget change during the month", () => {
  it("warns before stopping and, once confirmed, stops until the 1st and resumes in the new month", async () => {
    const sim = await world(40_000);
    await sim.runDays(12);
    const spent = await spentRub(sim, "2026-10-01", "2026-10-31");
    expect(spent).toBeGreaterThan(1_000);
    const lower = Math.floor(spent / 2);

    const preview = await previewBudgetChange(sim.ctx, "b1", lower);
    expect(preview.kind).toBe("will_stop");
    expect(preview.message).toMatch(/^В этом месяце уже потрачено .+ — реклама будет остановлена до 1-го числа\.$/);
    expect((await changeBudget(sim.ctx, "b1", lower, false)).applied).toBe(false);

    await changeBudget(sim.ctx, "b1", lower, true);
    expect((await sim.store.directions("b1")).every((d) => d.status === "paused")).toBe(true);
    expect((await sim.store.notifications("b1")).some((n) => n.kind === "budget_95")).toBe(true);

    await sim.runHours(24 * 20 + 1); // past 1 November 03:00 Moscow
    expect((await sim.store.directions("b1")).some((d) => d.status === "active")).toBe(true);
    expect((await sim.store.changes("b1")).some((c) => c.reasonCode === "BUDGET_NEW_MONTH" && c.status === "applied")).toBe(true);
  });

  it("notifies once at 80% of the month budget", async () => {
    const sim = await world(40_000);
    await sim.runDays(10);
    await sim.runHours(1);
    const visible = (await sim.store.stats("b1", "2026-10-01", "2026-10-31")).reduce((s, r) => s + r.spend, 0) / 100;
    await changeBudget(sim.ctx, "b1", Math.ceil(visible / 0.85), true);
    await sim.runHours(2);
    expect((await sim.store.notifications("b1")).filter((n) => n.kind === "budget_80")).toHaveLength(1);
  });

  it("shows the prorated ceiling when the budget changes in the launch month", async () => {
    const sim = await world(15_000, { start: "2026-10-25T00:00:00Z" });
    expect((await previewBudgetChange(sim.ctx, "b1", 15_000)).message).toBe("В этом месяце — до 3 387 ₽, дальше — 15 000 ₽ в месяц.");
  });
});

describe("owner pause", () => {
  it("is not lifted by the budget guard on the 1st, only by the owner", async () => {
    const sim = await world(40_000, { start: "2026-10-20T00:00:00Z" });
    const pause = await sim.executor.execute({ businessId: "b1", command: { type: "PauseAll" }, actor: "user", reasonCode: "USER_PAUSE", explanation: "Вы поставили рекламу на паузу" });
    expect(pause.status).toBe("applied");
    await sim.runDays(14);
    expect((await sim.store.directions("b1")).every((d) => d.status === "paused")).toBe(true);
    await sim.executor.execute({ businessId: "b1", command: { type: "ResumeAll" }, actor: "user", reasonCode: "USER_RESUME", explanation: "Вы возобновили рекламу" });
    expect((await sim.store.directions("b1")).every((d) => d.status === "active")).toBe(true);
  });
});

describe("daily spend verification", () => {
  it("opens an incident when the reported spend exceeds the month budget", async () => {
    const sim = await world(5_000);
    const campaign = (await sim.store.directions("b1"))[0]?.platformCampaignId ?? "";
    await sim.store.upsertStats("b1", [{ date: "2026-10-01", campaignId: campaign, adId: "x", impressions: 1, clicks: 1, leads: 0, spend: rubles(6_000) }]);
    await verifyBudget(sim.ctx, "b1");
    expect((await sim.store.incidents()).some((i) => i.kind === "budget_overrun" && i.businessId === "b1")).toBe(true);
  });
});

describe("stress: 200 simulated months", () => {
  it("never exceeds the month budget with an adversarial agent, cabinet limit raises and 48-hour outages", { timeout: 600_000 }, async () => {
    const rng = createRng(2026);
    const violations: string[] = [];
    for (let month = 0; month < 200; month++) {
      const budgetRub = 3_000 + Math.floor(rng() * 97_000);
      const sim = await world(budgetRub, { seed: 1_000 + month, agent: new AdversarialPolicy() });
      const outageStart = new Date("2026-10-01T00:00:00Z").getTime() + Math.floor(rng() * 25) * 86_400_000;
      const raiseOnDay = 1 + Math.floor(rng() * 28);
      for (let day = 0; day < 31; day++) {
        if (day === raiseOnDay) {
          const campaign = (await sim.store.directions("b1"))[0]?.platformCampaignId ?? "";
          sim.platform.cabinetEditCampaign(campaign, { weeklyLimit: rubles(budgetRub) });
        }
        await sim.runDays(1, { workerDown: (at) => at.getTime() >= outageStart && at.getTime() < outageStart + 48 * 3_600_000 });
      }
      const spent = await spentRub(sim, "2026-10-01", "2026-10-31");
      if (spent > budgetRub) {
        violations.push(`month ${month}: spent ${spent} of ${budgetRub}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
