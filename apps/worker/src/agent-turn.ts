import { randomUUID } from "node:crypto";
import { toRub } from "@impuls/agent";
import type { AgentToolbox, Justification, ToolCallRecord, ToolResult, TurnSnapshot, TurnTrigger } from "@impuls/agent";
import { emptyStats, toLocalDate, validateExplanation } from "@impuls/core";
import type { Command, Fact } from "@impuls/core";
import type { JobContext } from "./context";
import { turnLockKey } from "./locks";
import { loadBusinessView } from "./state";
import type { BusinessView } from "./state";
import type { ApprovalRequest, InboxEvent } from "./store";

export const MAX_ACTIONS_PER_DAY = 20;
export const MAX_CALLS_PER_TURN = 30;
export const MAX_NOTES = 50;
export const MAX_NOTE_LENGTH = 500;
export const EVENT_TURN_MIN_INTERVAL_MS = 3_600_000;
export const AGENT_UNAVAILABLE_INCIDENT_MS = 24 * 3_600_000;
export const APPROVAL_TTL_MS = 48 * 3_600_000;
export const APPROVAL_REPEAT_DELAY_MS = 3 * 24 * 3_600_000;
const TURN_TIMEOUT_MS = 10 * 60_000;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g;

/** Strips anything that looks like personal data from free text going to the agent. */
export const redactPersonalData = (text: string): string => text.replace(EMAIL, "[email]").replace(PHONE, "[телефон]");

/** Turns in progress in this process, so a settings change can interrupt them. */
const activeTurns = new Map<string, AbortController>();

/** Builds the agent snapshot strictly from allowlisted fields (ad-agent spec, data minimization). */
export const buildSnapshot = async (ctx: JobContext, view: BusinessView): Promise<TurnSnapshot> => {
  const card = view.business.card;
  const decisions = await ctx.store.userDecisions(view.business.id);
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
    budget: { monthRub: toRub(view.monthBudget), spentRub: toRub(view.spentMonth) },
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
    userDecisions: decisions.map((d) => ({ objectId: d.objectId, action: d.commandType, on: d.on })),
    notes: (await ctx.store.notes(view.business.id)).map(redactPersonalData),
  };
};

/** Every number the agent may cite: values from the turn snapshot (decision facts). */
export const snapshotFacts = (snapshot: TurnSnapshot): Fact[] => {
  const facts: Fact[] = [
    { kind: "rub", value: snapshot.goal.costPerLeadRub },
    { kind: "rub", value: snapshot.budget.monthRub },
    { kind: "rub", value: snapshot.budget.spentRub },
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

const objectIdOf = (command: Command): string =>
  "adId" in command ? command.adId : "directionId" in command ? command.directionId : "business";

/** Major actions that need the owner's approval in the «Спрашивать» mode (campaign-settings spec). */
const isMajorAction = (command: Command, view: BusinessView): boolean => {
  if (command.type === "PauseDirection" || command.type === "StartExperiment") {
    return true;
  }
  if (command.type === "SetSpendLimit") {
    const direction = view.directions.find((d) => d.id === command.directionId);
    const total = view.directions.filter((d) => d.status === "active").reduce((sum, d) => sum + d.weeklyLimit, 0);
    return direction !== undefined && total > 0 && Math.abs(command.weeklyLimit - direction.weeklyLimit) > total * 0.3;
  }
  return false;
};

export type TurnOutcome = { status: "completed" | "failed" | "cancelled"; turnId: string } | { status: "skipped" };

/**
 * Runs one agent turn: at most one per business at a time, a fresh session per turn,
 * tools bound to the business on the server side.
 */
export const runAgentTurn = async (ctx: JobContext, businessId: string, trigger: TurnTrigger): Promise<TurnOutcome> => {
  if (!(await ctx.store.getFlag("agent_enabled", businessId))) {
    return { status: "skipped" };
  }
  const outcome = await ctx.locks.tryWithLock(turnLockKey(businessId), async (): Promise<TurnOutcome> => {
    const platform = ctx.platformFor(businessId);
    const view = await loadBusinessView(ctx.store, businessId, ctx.clock, platform.capabilities());
    const snapshot = await buildSnapshot(ctx, view);
    const facts = snapshotFacts(snapshot);
    const turnId = `turn-${randomUUID()}`;
    const controller = new AbortController();
    activeTurns.set(businessId, controller);
    const calls: ToolCallRecord[] = [];
    let callsThisTurn = 0;

    const actionsToday = async (): Promise<number> => {
      const dayAgo = ctx.clock.now().getTime() - 24 * 3_600_000;
      return (await ctx.store.changes(businessId)).filter((c) => c.actor === "agent" && c.status === "applied" && c.createdAt.getTime() >= dayAgo).length;
    };

    const requestApproval = async (command: Command, justification: Justification): Promise<ToolResult> => {
      const objectId = objectIdOf(command);
      const recentExpired = (await ctx.store.approvals(businessId)).some(
        (a) =>
          a.objectId === objectId &&
          a.command.type === command.type &&
          (a.status === "pending" || (a.status === "expired" && ctx.clock.now().getTime() - (a.decidedAt?.getTime() ?? 0) < APPROVAL_REPEAT_DELAY_MS)),
      );
      if (recentExpired) {
        return toolResult("rejected", "это предложение уже ждёт ответа или истекло меньше 3 дней назад", "APPROVAL_PENDING");
      }
      await ctx.store.saveApproval({
        id: `apr-${randomUUID()}`,
        businessId,
        command,
        objectId,
        reasonCode: justification.reasonCode,
        explanation: justification.text,
        turnId,
        createdAt: ctx.clock.now(),
        status: "pending",
        decidedAt: null,
      });
      await ctx.store.notify({
        businessId,
        kind: "approval_request",
        message: `Я предлагаю изменение и жду вашего решения: ${justification.text} Ответьте в разделе «Нужно ваше участие» — без ответа предложение отменится через 48 часов.`,
        at: ctx.clock.now(),
      });
      return toolResult("queued", "отправлено владельцу на подтверждение");
    };

    const tools: AgentToolbox = {
      act: async (command: Command, justification: Justification): Promise<ToolResult> => {
        callsThisTurn++;
        let result: ToolResult;
        if (!(await ctx.store.getFlag("agent_enabled", businessId))) {
          controller.abort("agent_disabled");
        }
        if (controller.signal.aborted) {
          result = toolResult("rejected", "ход прерван: изменились настройки", "TURN_CANCELLED");
        } else if (callsThisTurn > MAX_CALLS_PER_TURN) {
          result = toolResult("rejected", "лимит вызовов за ход исчерпан", "TURN_CALL_LIMIT");
        } else if ((await actionsToday()) >= MAX_ACTIONS_PER_DAY) {
          result = toolResult("rejected", "лимит действий на сегодня исчерпан", "DAILY_ACTION_LIMIT");
        } else if (justification.reasonCode.trim() === "" || justification.text.trim() === "") {
          result = toolResult("rejected", "нужно обоснование: код причины и текст для владельца бизнеса", "JUSTIFICATION_REQUIRED");
        } else {
          const issues = validateExplanation(justification.text, facts);
          if (issues.length > 0) {
            result = toolResult("rejected", issues.map((i) => i.message).join("; "), "EXPLANATION_INVALID");
          } else if (view.business.autonomy === "ask" && isMajorAction(command, view)) {
            result = await requestApproval(command, justification);
          } else {
            const execution = await ctx.executor.execute({
              businessId,
              command,
              actor: "agent",
              reasonCode: justification.reasonCode,
              explanation: justification.text,
              turnId,
            });
            if (execution.status === "applied" || execution.status === "clamped") {
              result = toolResult(execution.status, execution.message);
            } else {
              result = toolResult("rejected", execution.message, execution.code);
            }
          }
        }
        calls.push({ command, justification, result });
        return result;
      },
      saveNote: async (text: string): Promise<void> => {
        const notes = [...(await ctx.store.notes(businessId)), redactPersonalData(text).slice(0, MAX_NOTE_LENGTH)];
        await ctx.store.saveNotes(businessId, notes.slice(-MAX_NOTES));
      },
    };

    const record = {
      id: turnId,
      businessId,
      trigger: trigger.kind,
      runtime: ctx.agent.name,
      instructionsVersion: ctx.agent.instructionsVersion,
      startedAt: ctx.clock.now(),
      finishedAt: null,
      status: "running" as const,
      context: { trigger, snapshot },
      calls: [] as unknown[],
      summary: null,
    };
    await ctx.store.saveTurn(record);
    const timer = setTimeout(() => controller.abort("timeout"), TURN_TIMEOUT_MS);
    try {
      const result = await ctx.agent.runTurn({ trigger, snapshot, tools, signal: controller.signal });
      const status = controller.signal.aborted ? "cancelled" : "completed";
      await ctx.store.saveTurn({ ...record, status, finishedAt: ctx.clock.now(), calls, summary: result.summary });
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
  return outcome ?? { status: "skipped" };
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
    return { status: "skipped" };
  }
  const trigger = mergeEvents(events);
  const urgent = trigger.kind === "settings_changed" || trigger.kind === "launch";
  if (!urgent) {
    const lastEventTurn = Math.max(0, ...(await ctx.store.turns(businessId)).filter((t) => t.trigger === "moderation_rejected" || t.trigger === "experiment_finished").map((t) => t.startedAt.getTime()));
    if (ctx.clock.now().getTime() - lastEventTurn < EVENT_TURN_MIN_INTERVAL_MS) {
      return { status: "skipped" };
    }
  }
  const outcome = await runAgentTurn(ctx, businessId, trigger);
  if (outcome.status !== "skipped") {
    await ctx.store.consumeInbox(events.map((e) => e.id), outcome.turnId);
  }
  return outcome;
};

/** Owner's answer to an approval request; a decline is respected for 14 days. */
export const decideApproval = async (ctx: JobContext, businessId: string, approvalId: string, approve: boolean): Promise<ApprovalRequest> => {
  const request = (await ctx.store.approvals(businessId)).find((a) => a.id === approvalId);
  if (!request || request.status !== "pending") {
    throw new Error(`Approval ${approvalId} is not pending`);
  }
  const decided: ApprovalRequest = { ...request, status: approve ? "approved" : "declined", decidedAt: ctx.clock.now() };
  await ctx.store.saveApproval(decided);
  if (approve) {
    await ctx.executor.execute({ businessId, command: request.command, actor: "agent", reasonCode: request.reasonCode, explanation: request.explanation, turnId: request.turnId });
  } else {
    const business = await ctx.store.getBusiness(businessId);
    await ctx.store.addUserDecision(businessId, { objectId: request.objectId, commandType: request.command.type, on: toLocalDate(ctx.clock.now(), business.timeZone) });
  }
  return decided;
};

/** Pending approvals expire after 48 hours without being applied. */
export const expireApprovals = async (ctx: JobContext, businessId: string): Promise<number> => {
  let expired = 0;
  for (const request of await ctx.store.approvals(businessId)) {
    if (request.status === "pending" && ctx.clock.now().getTime() - request.createdAt.getTime() >= APPROVAL_TTL_MS) {
      await ctx.store.saveApproval({ ...request, status: "expired", decidedAt: ctx.clock.now() });
      expired++;
    }
  }
  return expired;
};
