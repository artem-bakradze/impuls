import type { Actor } from "@impuls/core";

/** The fields of a history entry that tell what kind of change it is; safe to import from client components. */
export interface ChangeKindFields {
  actor: Actor;
  author: "service" | "user" | "cabinet";
  reasonCode: string;
}

/**
 * A weekly limit cut by the budget guard to fit what is left of the month (add-simulation-mode decision 13): shown
 * folded by day, not marked on the decisions screen and never rolled back one by one (change-history spec).
 */
export const isBudgetAdjustment = (entry: Pick<ChangeKindFields, "actor" | "reasonCode">): boolean =>
  entry.actor === "budget_guard" && entry.reasonCode === "BUDGET_FIT";

/** The mark of a day on which the rules decided without the agent; the insight feed shows it as the day's heading. */
export const RULES_DAY_CODE = "RULES_DAY";

/** The mark of a day without reasons for the agent's turn (ad-agent «Поводы для хода агента»): one quiet line in the feed. */
export const QUIET_DAY_CODE = "QUIET_DAY";

/** Why a budget-guard limit cut has no «Вернуть как было», in the owner's words. */
export const BUDGET_ADJUSTMENT_REASON = "лимит пересчитывается сам по остатку бюджета; вернуть можно решение, к которому он относится";

/**
 * A decision about the ads: a rule or the agent paused, scaled or checked something, an A/B check ended, or an edit
 * from the Direct cabinet appeared. What «До следующего решения» waits for (simulation-mode spec); the budget guard
 * and the owner's own changes are not decisions.
 */
export const isAdDecision = (entry: ChangeKindFields): boolean =>
  entry.author === "cabinet" || entry.actor === "safety_net" || entry.actor === "agent" || entry.reasonCode.startsWith("EXPERIMENT_");
