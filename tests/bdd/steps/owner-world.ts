import { HeuristicPolicy, TemplateCreativeEngine, TemplateImageEngine } from "@impuls/agent";
import type { AgentRuntime, AgentToolbox, TurnResult, TurnSnapshot, TurnTrigger } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { SimulatedPlatform } from "../../../packages/platforms/src/simulator";
import type { BreakdownDimension } from "../../../packages/platforms/src/contract";
import { CommandExecutor, controlSimulation, launchSimulation, ManualClock, MemoryLockManager, MemoryStore, savedPeriodForm } from "@impuls/worker";
import type { JobContext, LaunchPlan, PeriodAdInput, PeriodDays, PeriodForm, PeriodMarket } from "@impuls/worker";
import { feedDays } from "../../../apps/web/src/lib/insights-model";
import type { HistoryItem } from "../../../apps/web/src/lib/history-view";
import { buildServiceWork } from "../../../apps/web/src/lib/service-work";
import { simulationStatusOf } from "../../../apps/web/src/lib/simulation-model";
import { livedPeriods } from "../../../apps/web/src/lib/lived-periods";

/** 30 October: the simulation starts on Sunday, 1 November, at 09:00 Moscow time. */
export const REAL_START = new Date("2026-10-30T07:00:00Z");

/** An ad that brings leads cheaply, one that spends without leads, and one the scenarios name by the spec's example. */
export const GOOD = "Маникюр у метро";
export const BAD = "Маникюр без записи";
export const PLAIN = "Маникюр с покрытием";
export const PARTNER = "Ноготок — запись онлайн";

/**
 * The wizard's plan: three ads in search, two on the partner sites, with the weekly limits budget-guard keeps for
 * 15 000 ₽ a month. Titles have no digits: an agent's words quote them, and every number it says must be a fact.
 */
export const ownerPlan: LaunchPlan = {
  landingUrl: "https://nogotok.example",
  city: "Москва",
  directions: [
    { name: "Маникюр — Поиск", channel: "search", weeklyLimitRub: 1_620, keywords: ["маникюр москва"], negativeKeywords: [], ads: [GOOD, BAD, PLAIN].map((title) => ({ title, text: "У метро, без очереди" })) },
    { name: "Маникюр — Сайты-партнёры", channel: "network", weeklyLimitRub: 1_080, keywords: [], negativeKeywords: [], ads: [PARTNER, "Ноготок — маникюр рядом"].map((title) => ({ title, text: "Запись онлайн" })) },
  ],
};

export type Numbers = { impressions: number; clicks: number; leads: number; spendRub: number };

/** The deterministic agent, held on its next turn until released: a model turn of many seconds. */
export class HeldAgent implements AgentRuntime {
  readonly name = "policy:held";
  readonly instructionsVersion = "test";
  readonly decides = true;
  armed = false;
  private readonly inner = new HeuristicPolicy();
  private release: () => void = () => undefined;
  private markStarted: () => void = () => undefined;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });
  async runTurn(input: { trigger: TurnTrigger; snapshot: TurnSnapshot; tools: AgentToolbox; signal: AbortSignal }): Promise<TurnResult> {
    if (this.armed) {
      this.armed = false;
      await new Promise<void>((resolve) => {
        this.release = resolve;
        this.markStarted();
      });
    }
    return this.inner.runTurn(input);
  }
  finish(): void {
    this.release();
  }
}

/**
 * A business that launched a simulation from the wizard, on the worker in memory with the given agent: the owner
 * enters periods of stats as the window sends them (simulation-mode spec «Статистика периода от владельца»). Any call
 * to the Direct platform is counted and fails.
 */
export const ownerWorld = async (
  agent: AgentRuntime = new HeuristicPolicy(),
  /** `searchWeeklyRub` and `monthlyBudgetRub` make room for the spec's weeks of 4 200 ₽ in search (simulation-breakdowns). */
  options: { launch?: boolean; goalRub?: number; searchWeeklyRub?: number; monthlyBudgetRub?: number } = {},
) => {
  const store = new MemoryStore();
  store.emails.set("b1", "owner@example.com");
  await store.saveBusiness({
    id: "b1",
    userId: "u1",
    timeZone: "Europe/Moscow",
    monthlyBudgetRub: options.monthlyBudgetRub ?? 15_000,
    launchedOn: null,
    csoSource: options.goalRub === undefined ? { kind: "auto", reference: rubles(500) } : { kind: "user", goal: rubles(options.goalRub) },
    miniSite: null,
    leadGoalId: null,
    mode: "direct",
    card: { category: "Маникюр", services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }], area: "", hours: "Пн–Вс 10:00–20:00", advantages: [], name: "Ноготок", address: "", city: "Москва", siteUrl: "https://nogotok.example" },
  });
  const clock = new ManualClock(REAL_START);
  const locks = new MemoryLockManager();
  const directCalls: string[] = [];
  const platformFor = (businessId: string) => {
    directCalls.push(businessId);
    throw new Error("The Direct API must not be called in a simulation");
  };
  const ctx: JobContext = { store, clock, locks, executor: new CommandExecutor({ store, locks, clock, platformFor }), platformFor, agent, creatives: new TemplateCreativeEngine(), images: new TemplateImageEngine() };
  const plan: LaunchPlan =
    options.searchWeeklyRub === undefined
      ? ownerPlan
      : { ...ownerPlan, directions: ownerPlan.directions.map((d) => (d.channel === "search" ? { ...d, weeklyLimitRub: options.searchWeeklyRub ?? d.weeklyLimitRub } : d)) };
  if (options.launch !== false) await launchSimulation(ctx, "b1", plan);

  const record = async () => {
    const simulation = await store.getSimulation("b1");
    if (!simulation) throw new Error("no simulation");
    return simulation;
  };
  /** The window as it opens now: the ads shown and what Direct would spend on each direction. */
  const form = async (): Promise<PeriodForm> => savedPeriodForm(await record(), await store.directions("b1"), await store.ads("b1"), "Europe/Moscow");
  /** The numbers by ad title, for the ad shown now under it (a check's variant repeats its ad's title). */
  const rowsOf = async (rows: Record<string, Numbers>): Promise<PeriodAdInput[]> => {
    const shown = (await form()).directions.flatMap((d) => d.ads);
    return Object.entries(rows).map(([title, numbers]) => {
      const ad = shown.find((a) => a.title === title);
      if (!ad) throw new Error(`No shown ad «${title}»`);
      return { adId: ad.id, ...numbers };
    });
  };
  /** One period as the window sends it, with its marks when given (simulation-breakdowns). */
  const enter = async (days: PeriodDays, rows: Record<string, Numbers> = {}, market?: PeriodMarket) =>
    controlSimulation(ctx, "b1", { action: "period", days, ads: await rowsOf(rows), ...(market !== undefined && { market }) });
  /** The search direction's breakdown over the dates, as Direct would report it from the saved market. */
  const breakdown = async (dimension: BreakdownDimension, from: string, to: string) => {
    const simulation = await record();
    const market = new SimulatedPlatform({ seed: 1, timeZone: "Europe/Moscow", now: () => simulation.simNow, truthFor: () => null });
    market.restore(simulation.state);
    const search = (await store.directions("b1")).find((d) => d.channel === "search");
    return market.getBreakdown([search?.platformCampaignId ?? ""], from, to, dimension);
  };
  /**
   * A typical week of the owner's numbers: one ad spends without leads, two bring them cheaply; every amount is a share
   * of what Direct would let the direction spend now.
   */
  const week = async () => {
    const rows: PeriodAdInput[] = [];
    for (const direction of (await form()).directions) {
      const room = direction.roomRub[7];
      const add = (title: string, share: number, clicks: number, leads: number) => {
        const ad = direction.ads.find((a) => a.title === title);
        const spendRub = Math.floor(room * share);
        if (ad && spendRub > 0) rows.push({ adId: ad.id, impressions: clicks * 20, clicks, leads, spendRub });
      };
      add(BAD, 0.6, 40, 0);
      add(GOOD, 0.3, 30, 4);
      add(PARTNER, 0.5, 20, 2);
    }
    await controlSimulation(ctx, "b1", { action: "period", days: 7, ads: rows });
  };
  /** The player as the owner sees it, from the same pure model the web uses. */
  const player = async () =>
    simulationStatusOf({ simulation: await record(), timeZone: "Europe/Moscow", changes: (await store.changes("b1")).length, runningTurn: await store.runningTurn("b1"), form: await form() });
  /** «Реклама»'s ads and history as the web builds them. */
  const work = async () => {
    const simulation = await record();
    const changes = await store.changes("b1");
    const history: HistoryItem[] = changes.map((c) => ({
      id: c.id,
      at: c.createdAt.toISOString(),
      author: c.author,
      object: c.objectKind === "ad" ? "Объявление" : "Реклама",
      diff: [],
      explanation: c.explanation,
      outcome: null,
      turnId: c.turnId,
      insight: null,
      status: c.status,
      reverted: c.revertedById !== null,
      rollback: { kind: "available", consequences: [] },
      budgetAdjustment: false,
    }));
    const reviews = feedDays({ insights: await store.insights("b1"), turns: await store.turnDigests("b1"), timeZone: "Europe/Moscow", since: null, entries: new Map(history.map((h) => [h.id, h])) });
    return buildServiceWork({
      ads: await store.ads("b1"),
      directions: await store.directions("b1"),
      stats: await store.stats("b1", "2026-11-01", "2027-01-31"),
      today: "2027-01-31",
      startedOn: "2026-11-01",
      timeZone: "Europe/Moscow",
      cso: rubles(500),
      reviews,
      history,
      changes,
      openChecks: [],
      weeks: livedPeriods(simulation, "Europe/Moscow"),
    });
  };
  const totals = async (title: string) => {
    const ad = (await store.ads("b1")).find((a) => a.title === title);
    const rows = (await store.stats("b1", "2026-10-01", "2027-01-31")).filter((r) => r.adId === ad?.platformAdId);
    return rows.reduce((s, r) => ({ impressions: s.impressions + r.impressions, clicks: s.clicks + r.clicks, leads: s.leads + r.leads, spend: s.spend + r.spend }), { impressions: 0, clicks: 0, leads: 0, spend: 0 });
  };
  return { store, clock, ctx, directCalls, record, form, rowsOf, enter, breakdown, week, player, work, totals };
};

export type OwnerWorld = Awaited<ReturnType<typeof ownerWorld>>;
