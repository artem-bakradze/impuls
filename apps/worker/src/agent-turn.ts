import { randomUUID } from "node:crypto";
import { toRub, turnInstructionsVersion } from "@impuls/agent";
import type {
  AgentToolbox,
  BreakdownAnswer,
  HypothesisDraft,
  HypothesisResult,
  HypothesisView,
  ObservationDraft,
  ToolCallRecord,
  ToolResult,
  TurnSnapshot,
  TurnTrigger,
  TurnUsage,
} from "@impuls/agent";
import { addDays, catalogFacts, emptyStats, monthKey, toLocalDate, validateExplanation, validateInsight } from "@impuls/core";
import type { Command, Fact, InsightDraft, InsightFact } from "@impuls/core";
import { breakdownForAgent, breakdownPeriod } from "./analyst";
import type { AgentCosts, JobContext } from "./context";
import { RULES_DAY_CODE } from "./change-kinds";
import { budgetFigures, directionLabel, factCatalog, saveAgentInsight } from "./insights";
import { turnLockKey } from "./locks";
import { loadBusinessView } from "./state";
import type { BusinessView } from "./state";
import { prepareExperiment } from "./experiments";
import type { AgentTurnRecord, HypothesisRecord, InboxEvent } from "./store";

export const MAX_ACTIONS_PER_DAY = 20;
export const MAX_CALLS_PER_TURN = 30;
export const EVENT_TURN_MIN_INTERVAL_MS = 3_600_000;
export const AGENT_UNAVAILABLE_INCIDENT_MS = 24 * 3_600_000;
const TURN_TIMEOUT_MS = 10 * 60_000;
/** Insights the agent reads back so as not to repeat itself (ad-agent spec). */
const RECENT_INSIGHT_DAYS = 14;
/** Open hypotheses a business may have at once, and how long closed ones are read back (ad-agent spec «Журнал гипотез»). */
export const MAX_OPEN_HYPOTHESES = 10;
const RECENT_HYPOTHESIS_DAYS = 14;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g;

/** Strips anything that looks like personal data from free text going to the agent. */
export const redactPersonalData = (text: string): string => text.replace(EMAIL, "[email]").replace(PHONE, "[телефон]");

/** Turns in progress in this process, so a settings change can interrupt them. */
const activeTurns = new Map<string, AbortController>();

/** Builds the agent snapshot strictly from allowlisted fields (ad-agent spec, data minimization). */
export const buildSnapshot = async (ctx: JobContext, view: BusinessView): Promise<TurnSnapshot> => {
  const card = view.business.card;
  const [decisions, experiments, rows14] = await Promise.all([
    ctx.store.userDecisions(view.business.id),
    ctx.store.experiments(view.business.id),
    ctx.store.stats(view.business.id, addDays(view.today, -13), view.today),
  ]);
  const running = experiments.find((e) => e.status === "running");
  const budget = budgetFigures(view);
  return {
    today: view.today,
    business: {
      category: redactPersonalData(card.category),
      services: card.services.map((s) => ({ name: redactPersonalData(s.name), priceRub: s.priceRub })),
      area: redactPersonalData(card.area),
      hours: redactPersonalData(card.hours),
      advantages: card.advantages.map(redactPersonalData),
    },
    goal: { costPerLeadRub: toRub(view.cso), mode: view.business.csoSource.kind },
    budget: { monthRub: budget.monthRub, spentRub: budget.spentRub, leftRub: budget.leftRub, evenPaceRub: budget.evenPaceRub },
    strategyCatalog: ctx.platformFor(view.business.id).capabilities().strategies.map((s) => ({ id: s.id, title: s.title })),
    directions: view.directions.map((d) => {
      const stats = view.directionStats14.get(d.id) ?? emptyStats();
      return {
        id: d.id,
        name: d.name,
        status: d.status,
        weeklyLimitRub: toRub(d.weeklyLimit),
        strategyId: d.strategyId,
        class: view.directionClasses.get(d.id) ?? "learning",
        spend14Rub: toRub(stats.spend),
        leads14: stats.leads,
        spend7Rub: toRub(view.spendLast7.get(d.id) ?? 0),
      };
    }),
    ads: view.ads.map((a) => {
      const stats = view.adStats14.get(a.id) ?? emptyStats();
      return {
        id: a.id,
        directionId: a.directionId,
        status: a.status,
        title: a.title,
        text: a.text,
        class: view.adClasses.get(a.id) ?? "learning",
        spend14Rub: toRub(stats.spend),
        leads14: stats.leads,
      };
    }),
    experiment: running ? { adId: running.adId, variantAdId: running.variantAdId, hypothesis: running.hypothesis, startedOn: running.startedOn } : null,
    userDecisions: decisions.map((d) => ({ objectId: d.objectId, action: d.commandType, on: d.on })),
    facts: factCatalog(view, rows14),
  };
};

/** Every number the agent may cite besides the catalog: values the decision facts allow (e.g. a limit +20%). */
export const snapshotFacts = (snapshot: TurnSnapshot): Fact[] => {
  const facts: Fact[] = [
    { kind: "rub", value: snapshot.goal.costPerLeadRub },
    { kind: "rub", value: snapshot.budget.monthRub },
    { kind: "rub", value: snapshot.budget.spentRub },
    ...catalogFacts(snapshot.facts),
  ];
  for (const item of [...snapshot.directions, ...snapshot.ads]) {
    facts.push({ kind: "rub", value: item.spend14Rub }, { kind: "count", value: item.leads14 });
    if (item.leads14 > 0) {
      facts.push({ kind: "rub", value: Math.round(item.spend14Rub / item.leads14) });
    }
  }
  for (const d of snapshot.directions) {
    facts.push({ kind: "rub", value: d.weeklyLimitRub }, { kind: "rub", value: Math.floor(d.weeklyLimitRub * 1.2) });
  }
  return facts;
};

const toolResult = (status: ToolResult["status"], message: string, code = ""): ToolResult =>
  status === "rejected" ? { status, code, message } : { status, message };

export type TurnOutcome =
  | { status: "completed" | "failed" | "cancelled"; turnId: string }
  | { status: "skipped"; reason: "disabled" | "busy" | "cost_limit" | "no_events" | "too_soon" };

/** Model spend of a turn in kopecks, rounded up so the limit is never undercounted (ad-agent spec «Лимиты агента»). */
const turnCost = (usage: TurnUsage | null, costs: AgentCosts | undefined): number =>
  usage === null || costs === undefined ? 0 : Math.ceil((usage.inputTokens * costs.inputKopecksPerMTok + usage.outputTokens * costs.outputKopecksPerMTok) / 1_000_000);

/**
 * Whether the business has spent its model budget: this month's turns, or for a simulation the turns of the run
 * (a restart deletes them together with the rest of the simulation's data).
 */
export const agentBudgetSpent = async (ctx: JobContext, businessId: string): Promise<boolean> => {
  const costs = ctx.agentCosts;
  if (costs === undefined) return false;
  const business = await ctx.store.getBusiness(businessId);
  const turns = await ctx.store.turns(businessId);
  if (business.mode === "simulation") {
    return turns.reduce((sum, t) => sum + t.costKopecks, 0) >= costs.simulationRunLimitKopecks;
  }
  const month = monthKey(toLocalDate(ctx.clock.now(), business.timeZone));
  const spent = turns.filter((t) => monthKey(toLocalDate(t.startedAt, business.timeZone)) === month).reduce((sum, t) => sum + t.costKopecks, 0);
  return spent >= costs.monthlyLimitKopecks;
};

/**
 * Runs one agent turn: at most one per business at a time, a fresh session per turn,
 * tools bound to the business on the server side. Every action and observation comes with an insight that is
 * checked against the snapshot before anything is executed (insights spec).
 */
export const runAgentTurn = async (ctx: JobContext, businessId: string, trigger: TurnTrigger): Promise<TurnOutcome> => {
  if (!(await ctx.store.getFlag("agent_enabled", businessId))) {
    return { status: "skipped", reason: "disabled" };
  }
  if (await agentBudgetSpent(ctx, businessId)) {
    return { status: "skipped", reason: "cost_limit" };
  }
  // The weekly review runs on the strategy model when one is configured (add-agent-analyst-stage1 decision 7).
  const weekly = trigger.kind === "weekly_review" ? ctx.strategist : undefined;
  const agent = weekly?.runtime ?? ctx.agent;
  const costs = weekly?.costs ?? ctx.agentCosts;
  const outcome = await ctx.locks.tryWithLock(turnLockKey(businessId), async (): Promise<TurnOutcome> => {
    const platform = ctx.platformFor(businessId);
    const view = await loadBusinessView(ctx.store, businessId, ctx.clock, platform.capabilities());
    const snapshot = await buildSnapshot(ctx, view);
    const facts = snapshotFacts(snapshot);
    // The turn's fact catalog grows with the breakdowns the agent asks for (add-agent-analyst-stage1 decision 2).
    const catalog: InsightFact[] = [...snapshot.facts];
    const breakdowns = new Map<string, BreakdownAnswer>();
    const turnId = `turn-${randomUUID()}`;
    const controller = new AbortController();
    activeTurns.set(businessId, controller);
    const calls: ToolCallRecord[] = [];
    let callsThisTurn = 0;

    const actionsToday = async (): Promise<number> => {
      const dayAgo = ctx.clock.now().getTime() - 24 * 3_600_000;
      return (await ctx.store.changes(businessId)).filter((c) => c.actor === "agent" && c.status === "applied" && c.createdAt.getTime() >= dayAgo).length;
    };

    /** Refusals that come before the insight check: a stopped turn or exhausted limits. */
    const precheck = async (counted: boolean): Promise<ToolResult | null> => {
      callsThisTurn++;
      if (!(await ctx.store.getFlag("agent_enabled", businessId))) {
        controller.abort("agent_disabled");
      }
      if (controller.signal.aborted) return toolResult("rejected", "ход прерван: изменились настройки", "TURN_CANCELLED");
      if (callsThisTurn > MAX_CALLS_PER_TURN) return toolResult("rejected", "лимит вызовов за ход исчерпан", "TURN_CALL_LIMIT");
      if (counted && (await actionsToday()) >= MAX_ACTIONS_PER_DAY) return toolResult("rejected", "лимит действий на сегодня исчерпан", "DAILY_ACTION_LIMIT");
      return null;
    };
    const insightIssues = (insight: InsightDraft, extra: readonly Fact[] = []): Extract<ToolResult, { status: "rejected" }> | null => {
      const issues = validateInsight(insight, catalog, [...facts, ...extra]);
      return issues.length === 0 ? null : { status: "rejected", code: "INSIGHT_INVALID", message: issues.map((i) => i.message).join("; ") };
    };
    /** Percents an adjustment's insight may cite: the new value, the current one (it may change within the turn) and the step. */
    const commandFacts = async (command: Command): Promise<Fact[]> => {
      if (command.type !== "SetDeviceAdjustment") return [];
      const current = (await ctx.store.directions(businessId)).find((d) => d.id === command.directionId)?.deviceAdjustments[command.device] ?? 0;
      return [Math.abs(command.percent), Math.abs(current), Math.abs(command.percent - current)].map((value) => ({ kind: "percent", value }));
    };
    const rejected = (code: string, message: string) => ({ status: "rejected" as const, code, message });
    const hypothesisView = (h: HypothesisRecord): HypothesisView => ({
      id: h.id,
      statement: h.statement,
      check: h.check,
      checkOn: h.checkOn,
      status: h.status,
      result: h.result,
      openedOn: toLocalDate(h.openedAt, view.business.timeZone),
      closedOn: h.closedAt === null ? null : toLocalDate(h.closedAt, view.business.timeZone),
      facts: [...h.facts, ...h.resultFacts].map((f) => ({ object: f.object, metric: f.metric, period: f.period, value: f.value })),
    });

    /** Opens, updates or closes a hypothesis of the journal, its texts checked like an insight's (ad-agent spec «Журнал гипотез»). */
    const writeHypothesis = async (draft: HypothesisDraft): Promise<HypothesisResult> => {
      const stop = await precheck(false);
      if (stop?.status === "rejected") return stop;
      if (draft.checkOn < view.today) return rejected("CHECK_DAY_PASSED", "день проверки уже прошёл");
      const closing = draft.status !== "checking";
      if (closing && draft.result === undefined) return rejected("RESULT_REQUIRED", "чтобы закрыть гипотезу, нужен результат: что выяснили");
      const issues = insightIssues({ reasonCode: "HYPOTHESIS", observation: closing ? (draft.result ?? "") : draft.statement, factKeys: draft.factKeys, next: draft.check });
      if (issues) return issues;
      const journal = await ctx.store.hypotheses(businessId);
      const resolved = draft.factKeys.map((k) => catalog.find((f) => f.key === k)).filter((f): f is InsightFact => f !== undefined);
      const now = ctx.clock.now();
      if (draft.id === undefined) {
        if (closing) return rejected("NEW_IS_OPEN", "новая гипотеза записывается в статусе «проверяем»");
        if (journal.filter((h) => h.status === "checking").length >= MAX_OPEN_HYPOTHESES) {
          return rejected("HYPOTHESIS_LIMIT", "сначала закройте одну из открытых гипотез");
        }
        const id = `h-${randomUUID().slice(0, 12)}`;
        await ctx.store.saveHypothesis({
          id,
          businessId,
          openedTurnId: turnId,
          closedTurnId: null,
          statement: draft.statement,
          facts: resolved,
          check: draft.check,
          checkOn: draft.checkOn,
          status: "checking",
          result: null,
          resultFacts: [],
          openedAt: now,
          closedAt: null,
        });
        return { status: "applied", message: "гипотеза записана", id };
      }
      const existing = journal.find((h) => h.id === draft.id);
      if (!existing) return rejected("OBJECT_NOT_FOUND", "такой гипотезы нет");
      if (existing.status !== "checking") return rejected("ALREADY_CLOSED", "эта гипотеза уже закрыта");
      await ctx.store.saveHypothesis(
        closing
          ? { ...existing, status: draft.status, result: draft.result ?? null, resultFacts: resolved, closedTurnId: turnId, closedAt: now }
          : { ...existing, statement: draft.statement, facts: resolved, check: draft.check, checkOn: draft.checkOn },
      );
      return { status: "applied", message: closing ? "гипотеза закрыта" : "гипотеза обновлена", id: existing.id };
    };
    /** Every attempt with its answer, for the turn journal and the eval's share of checks passed at once. */
    const hypothesisCalls: { draft: HypothesisDraft; result: HypothesisResult }[] = [];

    const tools: AgentToolbox = {
      act: async (command: Command, insight: InsightDraft): Promise<ToolResult> => {
        let result = (await precheck(true)) ?? insightIssues(insight, await commandFacts(command));
        if (result === null) {
          const prepared = await prepareExperiment(ctx, businessId, command);
          if (!prepared.ok) {
            result = toolResult("rejected", prepared.message, prepared.code);
          } else {
            const execution = await ctx.executor.execute({ businessId, command: prepared.command, actor: "agent", reasonCode: insight.reasonCode, explanation: insight.observation, turnId });
            // The insight shows the decision whatever the guard answered (insights spec «Что решили»).
            await saveAgentInsight(ctx, { view, catalog, turnId, draft: insight, command: prepared.command, result: execution });
            result =
              execution.status === "applied" || execution.status === "clamped" ? toolResult(execution.status, execution.message) : toolResult("rejected", execution.message, execution.code);
          }
        }
        calls.push({ command, insight, result });
        return result;
      },
      observe: async (insight: ObservationDraft): Promise<ToolResult> => {
        const result = (await precheck(false)) ?? insightIssues(insight) ?? toolResult("applied", "инсайт сохранён");
        if (result.status === "applied") {
          await saveAgentInsight(ctx, { view, catalog, turnId, draft: insight, command: null, result: null });
        }
        calls.push({ command: null, insight, result });
        return result;
      },
      recentInsights: async () => {
        const since = ctx.clock.now().getTime() - RECENT_INSIGHT_DAYS * 86_400_000;
        return (await ctx.store.insights(businessId))
          .filter((i) => i.createdAt.getTime() >= since && i.reasonCode !== RULES_DAY_CODE)
          .map((i) => ({ at: i.createdAt.toISOString(), observation: i.observation, decision: i.decision.text, facts: i.facts.map((f) => ({ object: f.object, metric: f.metric, period: f.period, value: f.value })) }));
      },
      breakdown: async (directionId, dimension) => {
        const key = `${directionId}|${dimension}`;
        const cached = breakdowns.get(key);
        if (cached) return cached;
        const stop = await precheck(false);
        if (stop?.status === "rejected") return stop;
        const direction = view.directions.find((d) => d.id === directionId);
        if (!direction) return rejected("OBJECT_NOT_FOUND", "объект не найден");
        if (dimension === "query" && direction.channel !== "search") {
          return rejected("NO_QUERIES", "у рекламы на сайтах-партнёрах нет поисковых запросов");
        }
        const { from, to } = breakdownPeriod(view.today);
        const rows = (await platform.getBreakdown([direction.platformCampaignId], from, to, dimension)).filter((r) => r.campaignId === direction.platformCampaignId);
        // The direction as it is now: an action earlier in the turn may have changed its phrases or adjustments.
        const current = (await ctx.store.directions(businessId)).find((d) => d.id === directionId) ?? direction;
        const built = breakdownForAgent({ direction: current, label: directionLabel(view, directionId), dimension, rows, goal: view.cso });
        catalog.push(...built.facts);
        facts.push(...catalogFacts(built.facts), ...built.numbers);
        breakdowns.set(key, built.answer);
        return built.answer;
      },
      hypotheses: async () => {
        const since = ctx.clock.now().getTime() - RECENT_HYPOTHESIS_DAYS * 86_400_000;
        return (await ctx.store.hypotheses(businessId)).filter((h) => h.status === "checking" || (h.closedAt?.getTime() ?? 0) >= since).map(hypothesisView);
      },
      saveHypothesis: async (draft: HypothesisDraft): Promise<HypothesisResult> => {
        const result = await writeHypothesis(draft);
        hypothesisCalls.push({ draft, result });
        return result;
      },
    };

    const record: AgentTurnRecord = {
      id: turnId,
      businessId,
      trigger: trigger.kind,
      runtime: agent.name,
      instructionsVersion: turnInstructionsVersion(agent, trigger),
      startedAt: ctx.clock.now(),
      finishedAt: null,
      status: "running",
      context: { trigger, snapshot },
      calls: [],
      summary: null,
      summaryValid: false,
      inputTokens: null,
      outputTokens: null,
      usageSource: null,
      costKopecks: 0,
    };
    await ctx.store.saveTurn(record);
    const timer = setTimeout(() => controller.abort("timeout"), TURN_TIMEOUT_MS);
    try {
      const result = await agent.runTurn({ trigger, snapshot, tools, signal: controller.signal });
      const status = controller.signal.aborted ? "cancelled" : "completed";
      // «Разбор дня» is shown only when it is plain and every number in it is in the data (insights spec).
      const summaryValid = result.summary.trim() !== "" && validateExplanation(result.summary, facts).length === 0;
      await ctx.store.saveTurn({
        ...record,
        // The tools the agent used, reads included, and the breakdowns it read, for «Для специалистов» in the turn journal.
        context: {
          ...(record.context as object),
          ...(result.toolUse !== undefined && { toolUse: result.toolUse }),
          ...(breakdowns.size > 0 && { breakdowns: [...breakdowns.values()] }),
          ...(hypothesisCalls.length > 0 && { hypotheses: hypothesisCalls }),
        },
        status,
        finishedAt: ctx.clock.now(),
        calls,
        summary: result.summary,
        summaryValid,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        usageSource: result.usage?.source ?? null,
        costKopecks: turnCost(result.usage, costs),
      });
      return { status, turnId };
    } catch (error) {
      const status = controller.signal.aborted ? "cancelled" : "failed";
      await ctx.store.saveTurn({ ...record, status, finishedAt: ctx.clock.now(), calls, summary: error instanceof Error ? error.message : String(error) });
      if (status === "failed") {
        await reportUnavailability(ctx, businessId);
      }
      return { status, turnId };
    } finally {
      clearTimeout(timer);
      activeTurns.delete(businessId);
    }
  });
  return outcome ?? { status: "skipped", reason: "busy" };
};

/** Opens an incident when no turn of this business has completed for 24 hours (ad-agent spec). */
const reportUnavailability = async (ctx: JobContext, businessId: string): Promise<void> => {
  const now = ctx.clock.now().getTime();
  const turns = await ctx.store.turns(businessId);
  const lastOk = Math.max(0, ...turns.filter((t) => t.status === "completed").map((t) => (t.finishedAt ?? t.startedAt).getTime()));
  const firstFailure = Math.min(...turns.filter((t) => t.status === "failed" && t.startedAt.getTime() > lastOk).map((t) => t.startedAt.getTime()));
  const alreadyOpen = (await ctx.store.incidents()).some((i) => i.kind === "agent_unavailable" && i.businessId === businessId && i.openedAt.getTime() > lastOk);
  if (!alreadyOpen && now - firstFailure >= AGENT_UNAVAILABLE_INCIDENT_MS) {
    await ctx.store.openIncident({ kind: "agent_unavailable", businessId, message: "Agent turns have been failing for more than 24 hours", openedAt: ctx.clock.now() });
  }
};

/** Queues an event for the next turn; a settings change interrupts the running turn (ad-agent spec). */
export const enqueueAgentEvent = async (ctx: JobContext, businessId: string, trigger: TurnTrigger): Promise<void> => {
  if (!ctx.agent.decides || !(await ctx.store.getFlag("agent_enabled", businessId))) {
    // Without the agent nobody reads the inbox; it would only grow.
    return;
  }
  await ctx.store.addInboxEvent({ businessId, trigger: { ...trigger }, createdAt: ctx.clock.now() });
  if (trigger.kind === "settings_changed") {
    activeTurns.get(businessId)?.abort("settings_changed");
  }
};

const mergeEvents = (events: readonly InboxEvent[]): TurnTrigger => {
  const kinds = new Set(events.map((e) => e.trigger.kind));
  if (kinds.has("settings_changed")) return { kind: "settings_changed" };
  if (kinds.has("launch")) return { kind: "launch" };
  if (kinds.has("moderation_rejected")) {
    return { kind: "moderation_rejected", adIds: [...new Set(events.flatMap((e) => e.trigger.adIds ?? []))] };
  }
  return { kind: "experiment_finished", experimentIds: [...new Set(events.flatMap((e) => e.trigger.experimentIds ?? []))] };
};

/** Runs one turn for all queued events; moderation and experiment events at most once an hour. */
export const processAgentInbox = async (ctx: JobContext, businessId: string): Promise<TurnOutcome> => {
  const events = await ctx.store.pendingInbox(businessId);
  if (events.length === 0) {
    return { status: "skipped", reason: "no_events" };
  }
  const trigger = mergeEvents(events);
  const urgent = trigger.kind === "settings_changed" || trigger.kind === "launch";
  if (!urgent) {
    const lastEventTurn = Math.max(0, ...(await ctx.store.turns(businessId)).filter((t) => t.trigger === "moderation_rejected" || t.trigger === "experiment_finished").map((t) => t.startedAt.getTime()));
    if (ctx.clock.now().getTime() - lastEventTurn < EVENT_TURN_MIN_INTERVAL_MS) {
      return { status: "skipped", reason: "too_soon" };
    }
  }
  const outcome = await runAgentTurn(ctx, businessId, trigger);
  if (outcome.status !== "skipped") {
    await ctx.store.consumeInbox(events.map((e) => e.id), outcome.turnId);
  }
  return outcome;
};

