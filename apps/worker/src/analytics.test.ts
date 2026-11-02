import { AdversarialPolicy, IdlePolicy, QuietPolicy, RandomPolicy } from "@impuls/agent";
import type { AgentRuntime } from "@impuls/agent";
import { createRng, evaluateExperiment, rubles, sampleBinomial } from "@impuls/core";
import type { AdTruth } from "@impuls/platforms";
import { describe, expect, it } from "vitest";
import { checkModerationAndBalance, ClientConfirmationError, confirmClients, reconcileStats, weeklyClientCost } from "./analytics";
import { adviseOnGoal, evaluateExperiments } from "./optimization";
import { SimulationDriver } from "./simulation";

const good: AdTruth = { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) };
const bad: AdTruth = { impressionsPerDay: 800, ctr: 0.06, cr: 0, costPerClick: rubles(30) };

const world = async (options: { agent?: AgentRuntime; goalRub?: number; truths?: [AdTruth, AdTruth, AdTruth]; seed?: number; correctionProbability?: number; limits?: [number, number] } = {}) => {
  const sim = new SimulationDriver({
    start: new Date("2026-10-01T00:00:00Z"),
    seed: options.seed ?? 6,
    agent: options.agent ?? new IdlePolicy(),
    ...(options.correctionProbability !== undefined ? { correctionProbability: options.correctionProbability } : {}),
  });
  const [a, b, c] = options.truths ?? [good, bad, good];
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: 30_000,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(options.goalRub ?? 800) },
    directions: [
      { name: "Маникюр — Поиск", weeklyLimitRub: options.limits?.[0] ?? 2_000, ads: [{ title: "Маникюр у метро", truth: a }, { title: "Маникюр без записи", truth: b }] },
      { name: "Педикюр — Поиск", weeklyLimitRub: options.limits?.[1] ?? 1_500, ads: [{ title: "Педикюр", truth: c }] },
    ],
  });
  return sim;
};

describe("stats", () => {
  it("picks up retroactive corrections and matches the platform within 1 ₽ per campaign-day", async () => {
    const sim = await world({ correctionProbability: 1 });
    await sim.runDays(10);
    const campaigns = (await sim.store.directions("b1")).map((d) => d.platformCampaignId);
    const corrected = (await sim.platform.getStats(campaigns, "2026-10-01", "2026-10-06")).reduce((s, r) => s + r.spend, 0);
    const stored = (await sim.store.stats("b1", "2026-10-01", "2026-10-06")).reduce((s, r) => s + r.spend, 0);
    expect(stored).toBe(corrected);
    expect(await reconcileStats(sim.ctx, "b1")).toEqual([]);
  });

  it("opens an incident when stored stats deviate from the platform report", async () => {
    const sim = await world();
    await sim.runDays(8);
    const [row] = await sim.store.stats("b1", "2026-10-02", "2026-10-02");
    await sim.store.upsertStats("b1", [{ ...row!, spend: row!.spend + rubles(5) }]);
    expect((await reconcileStats(sim.ctx, "b1")).length).toBeGreaterThan(0);
    expect((await sim.store.incidents()).some((i) => i.kind === "stats_mismatch")).toBe(true);
  });
});

describe("clients", () => {
  it("computes cost per client from the owner's answer and refuses impossible numbers", async () => {
    const sim = await world();
    await sim.runDays(9);
    const before = await weeklyClientCost(sim.ctx, "b1", "2026-10-05");
    expect(before).toMatchObject({ kind: "unknown", hint: "Ответьте, сколько обращений стали клиентами, чтобы видеть стоимость клиента" });
    const leads = (await sim.store.stats("b1", "2026-10-05", "2026-10-11")).reduce((s, r) => s + r.leads, 0);
    await expect(confirmClients(sim.ctx, "b1", "2026-10-05", leads + 1)).rejects.toThrow(`Клиентов не может быть больше, чем обращений — за эту неделю их ${leads}`);
    await expect(confirmClients(sim.ctx, "b1", "2026-10-05", -1)).rejects.toBeInstanceOf(ClientConfirmationError);
    await confirmClients(sim.ctx, "b1", "2026-10-07", 2);
    const after = await weeklyClientCost(sim.ctx, "b1", "2026-10-05");
    expect(after).toMatchObject({ kind: "known", clients: 2 });
    expect(after.kind === "known" ? after.costPerClient : null).toBe(after.kind === "known" ? Math.round(after.spend / 2) : null);
  });
});

describe("moderation and balance", () => {
  it("notifies about a rejected ad, queues an agent turn and warns about a low balance", async () => {
    const sim = await world({ agent: new QuietPolicy() });
    await sim.runDays(7);
    const ad = (await sim.store.ads("b1"))[0];
    sim.platform.moderate(ad?.platformAdId ?? "", "rejected", "в тексте есть превосходная степень");
    sim.platform.setBalance(rubles(500));
    await checkModerationAndBalance(sim.ctx, "b1");
    const notes = await sim.store.notifications("b1");
    expect(notes.find((n) => n.kind === "moderation_rejected")?.message).toContain("в тексте есть превосходная степень");
    expect(notes.find((n) => n.kind === "low_balance")?.message).toMatch(/^Пополните баланс в Яндекс Директе — денег хватит примерно на \d+ дн\./);
    expect((await sim.store.pendingInbox("b1")).map((e) => e.trigger.kind)).toContain("moderation_rejected");
  });
});

describe("goal is more important than spending the budget", () => {
  it("pauses expensive directions, suggests raising the goal and explains the underspend", async () => {
    const pricey: AdTruth = { impressionsPerDay: 900, ctr: 0.06, cr: 0.06, costPerClick: rubles(30) }; // ≈ 500 ₽ per lead
    const sim = await world({ goalRub: 300, truths: [pricey, pricey, { ...pricey, cr: 0.02 }] });
    await sim.runDays(20);
    await adviseOnGoal(sim.ctx, "b1");
    const notes = await sim.store.notifications("b1");
    const advice = notes.find((n) => n.kind === "goal_unreachable");
    expect(advice?.message).toMatch(/^Сейчас обращение стоит около .+ — дороже вашей цели 300 ₽\. Можно поднять цель до .+ или оставить 300 ₽/);
    expect((await sim.store.getBusiness("b1")).csoSource).toEqual({ kind: "user", goal: rubles(300) });
    expect((await sim.store.directions("b1")).some((d) => d.status === "paused")).toBe(true);
  });

  it("calls the automatic goal the one the service picked, not the owner's", async () => {
    const pricey: AdTruth = { impressionsPerDay: 900, ctr: 0.06, cr: 0.06, costPerClick: rubles(30) };
    const sim = await world({ goalRub: 300, truths: [pricey, pricey, { ...pricey, cr: 0.02 }] });
    await sim.store.saveBusiness({ ...(await sim.store.getBusiness("b1")), csoSource: { kind: "auto", reference: rubles(300) } });
    await sim.runDays(20);
    await adviseOnGoal(sim.ctx, "b1");
    const advice = (await sim.store.notifications("b1")).find((n) => n.kind === "goal_unreachable");
    expect(advice?.message).toMatch(/^Сейчас обращение стоит около .+ — дороже цели, которую мы подобрали, \d[\d   ]* ₽\. Можно поднять цель до /);
  });
});

describe("experiments on the simulator", () => {
  it("keeps the better variant, pauses the other and writes both numbers to the history", async () => {
    const sim = await world({ agent: new QuietPolicy(), truths: [{ ...good, cr: 0.04 }, { ...good, cr: 0.04 }, good] });
    await sim.store.setFlag("automation_enabled", false, null);
    sim.queueAdTruth({ ...good, cr: 0.12 });
    await sim.executor.execute({
      businessId: "b1",
      command: {
        type: "StartExperiment",
        directionId: "b1-d1",
        adId: "b1-d1-a1",
        kind: "title",
        hypothesis: "Проверяем, привлечёт ли заголовок с городом больше обращений",
        variant: { title: "Маникюр с городом", text: "Маникюр у метро" },
      },
      actor: "safety_net",
      reasonCode: "SAFETY_START_EXPERIMENT",
      explanation: "Запустил проверку",
    });
    for (let day = 0; day < 21 && (await evaluateExperiments(sim.ctx, "b1")) === 0; day++) {
      await sim.runDays(1);
    }
    const [experiment] = await sim.store.experiments("b1");
    expect(experiment?.status).toBe("finished");
    expect((await sim.store.ads("b1")).find((a) => a.id === "b1-d1-a1")?.status).toBe("paused");
    const entry = (await sim.store.changes("b1")).find((c) => c.action.type === "FinishExperiment");
    expect(entry?.explanation).toMatch(/^Вариант «Маникюр с городом» приводил клиентов на \d+% дешевле — оставили его\. «Маникюр с городом»: \d+ обращений по .+, «Маникюр у метро»: \d+ обращений по/);
    const queued = (await sim.store.pendingInbox("b1")).some((e) => e.trigger.kind === "experiment_finished");
    const delivered = (await sim.store.turns("b1")).some((t) => t.trigger === "experiment_finished");
    expect(queued || delivered).toBe(true);
  });

  it("ends with «Разницы не обнаружено» when Direct shows the variant too rarely to collect 100 clicks", async () => {
    const sim = await world({ truths: [{ ...good, impressionsPerDay: 2_000 }, bad, good] });
    await sim.store.setFlag("automation_enabled", false, null);
    // Direct rotates ads inside a group by itself; here it hardly shows the variant.
    sim.queueAdTruth({ ...good, impressionsPerDay: 20 });
    await sim.executor.execute({
      businessId: "b1",
      command: { type: "StartExperiment", directionId: "b1-d1", adId: "b1-d1-a1", kind: "benefit", hypothesis: "Проверяем, сработает ли преимущество «Работаем до 22:00»", variant: { title: "Маникюр у метро", text: "Работаем до 22:00" } },
      actor: "safety_net",
      reasonCode: "SAFETY_START_EXPERIMENT",
      explanation: "Запустил проверку",
    });
    for (let day = 0; day < 23 && (await evaluateExperiments(sim.ctx, "b1")) === 0; day++) {
      await sim.runDays(1);
    }
    const entry = (await sim.store.changes("b1")).find((c) => c.action.type === "FinishExperiment");
    expect(entry?.reasonCode).toBe("EXPERIMENT_NO_DIFFERENCE");
    expect(entry?.explanation).toMatch(/^За 3 недели разница оказалась слишком маленькой, чтобы на неё полагаться\./);
  });

  it("picks the truly better variant in at least 80% of 50 runs when conversions differ by 50%", () => {
    let wins = 0;
    for (let seed = 0; seed < 50; seed++) {
      const rng = createRng(seed);
      const clicks = 300;
      const control = { impressions: 6_000, clicks, leads: sampleBinomial(rng, clicks, 0.06), spend: clicks * rubles(25) };
      const variant = { impressions: 6_000, clicks, leads: sampleBinomial(rng, clicks, 0.09), spend: clicks * rubles(25) };
      const outcome = evaluateExperiment({ experimentId: `exp-${seed}`, startedOn: "2026-10-01", today: "2026-10-22", control, variant });
      if (outcome.status === "variant_wins" || (outcome.status === "no_difference" && outcome.keep === "variant")) {
        wins++;
      }
    }
    expect(wins).toBeGreaterThanOrEqual(40);
  });
});

describe("optimization scenarios under any agent policy", () => {
  const policies: [string, () => AgentRuntime][] = [
    ["idle", () => new IdlePolicy()],
    ["adversarial", () => new AdversarialPolicy()],
    ["random", () => new RandomPolicy(77)],
  ];

  it.each(policies)("%s: the ad without leads is paused within 14 days", async (_name, agent) => {
    const sim = await world({ agent: agent() });
    await sim.runDays(14);
    // Either the ad is switched off, or it never got to waste money: no more than 4 × ЦСО in 14 days.
    const badAd = (await sim.store.ads("b1")).find((a) => a.title === "Маникюр без записи");
    const paused = (await sim.store.changes("b1")).some((c) => c.objectId === badAd?.id && c.status === "applied" && c.after.status === "paused");
    const wasted = (await sim.store.stats("b1", "2026-10-01", "2026-10-31")).filter((r) => r.adId === badAd?.platformAdId).reduce((s, r) => s + r.spend, 0);
    expect(paused || wasted <= 4 * rubles(800)).toBe(true);
  });

  it.each(policies)("%s: an effective direction that hits its limit gets more budget within 14 days", async (_name, agent) => {
    const demand: AdTruth = { impressionsPerDay: 3_000, ctr: 0.06, cr: 0.12, costPerClick: rubles(20) };
    const sim = await world({ agent: agent(), truths: [demand, demand, demand], limits: [1_000, 1_000] });
    await sim.runDays(14);
    const raised = (await sim.store.changes("b1")).some(
      (c) => c.objectKind === "direction" && c.status === "applied" && Number(c.after.weeklyLimit) > Number(c.before.weeklyLimit),
    );
    expect(raised).toBe(true);
  });
});
