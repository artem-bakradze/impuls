import { toRub } from "@impuls/agent";
import type { AgentToolbox, Justification, ToolCallRecord, ToolResult, TurnSnapshot, TurnTrigger } from "@impuls/agent";
import { emptyStats, validateExplanation } from "@impuls/core";
import type { Command, Fact } from "@impuls/core";
import type { JobContext } from "./context";
import { turnLockKey } from "./locks";
import { loadBusinessView } from "./state";
import type { BusinessView } from "./state";

export const MAX_ACTIONS_PER_DAY = 20;
export const MAX_CALLS_PER_TURN = 30;
export const MAX_NOTES = 50;
export const MAX_NOTE_LENGTH = 500;
const TURN_TIMEOUT_MS = 10 * 60_000;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g;

/** Strips anything that looks like personal data from free text going to the agent. */
export const redactPersonalData = (text: string): string => text.replace(EMAIL, "[email]").replace(PHONE, "[телефон]");

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

/**
 * Runs one agent turn: at most one per business at a time, a fresh session per turn,
 * tools bound to the business on the server side.
 */
export const runAgentTurn = async (ctx: JobContext, businessId: string, trigger: TurnTrigger): Promise<"completed" | "skipped" | "failed"> => {
  if (!(await ctx.store.getFlag("agent_enabled", businessId))) {
    return "skipped";
  }
  const outcome = await ctx.locks.tryWithLock(turnLockKey(businessId), async () => {
    const platform = ctx.platformFor(businessId);
    const view = await loadBusinessView(ctx.store, businessId, ctx.clock, platform.capabilities());
    const snapshot = await buildSnapshot(ctx, view);
    const facts = snapshotFacts(snapshot);
    const turnId = `turn-${businessId}-${ctx.clock.now().getTime()}`;
    const calls: ToolCallRecord[] = [];
    let callsThisTurn = 0;
    const actionsToday = async (): Promise<number> => {
      const dayAgo = ctx.clock.now().getTime() - 24 * 3_600_000;
      return (await ctx.store.changes(businessId)).filter((c) => c.actor === "agent" && c.status === "applied" && c.createdAt.getTime() >= dayAgo).length;
    };

    const tools: AgentToolbox = {
      act: async (command: Command, justification: Justification): Promise<ToolResult> => {
        callsThisTurn++;
        let result: ToolResult;
        if (callsThisTurn > MAX_CALLS_PER_TURN) {
          result = toolResult("rejected", "лимит вызовов за ход исчерпан", "TURN_CALL_LIMIT");
        } else if ((await actionsToday()) >= MAX_ACTIONS_PER_DAY) {
          result = toolResult("rejected", "лимит действий на сегодня исчерпан", "DAILY_ACTION_LIMIT");
        } else if (justification.reasonCode.trim() === "" || justification.text.trim() === "") {
          result = toolResult("rejected", "нужно обоснование: код причины и текст для владельца бизнеса", "JUSTIFICATION_REQUIRED");
        } else {
          const issues = validateExplanation(justification.text, facts);
          if (issues.length > 0) {
            result = toolResult("rejected", issues.map((i) => i.message).join("; "), "EXPLANATION_INVALID");
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

    const startedAt = ctx.clock.now();
    const record = {
      id: turnId,
      businessId,
      trigger: trigger.kind,
      runtime: ctx.agent.name,
      instructionsVersion: ctx.agent.instructionsVersion,
      startedAt,
      finishedAt: null,
      status: "running" as const,
      context: snapshot,
      calls: [] as unknown[],
      summary: null,
    };
    await ctx.store.saveTurn(record);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
    try {
      const result = await ctx.agent.runTurn({ trigger, snapshot, tools, signal: controller.signal });
      await ctx.store.saveTurn({ ...record, status: "completed", finishedAt: ctx.clock.now(), calls, summary: result.summary });
      return "completed" as const;
    } catch (error) {
      await ctx.store.saveTurn({
        ...record,
        status: "failed",
        finishedAt: ctx.clock.now(),
        calls,
        summary: error instanceof Error ? error.message : String(error),
      });
      return "failed" as const;
    } finally {
      clearTimeout(timer);
    }
  });
  return outcome ?? "skipped";
};
