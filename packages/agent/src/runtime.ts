import type { Command, EffectivenessClass, InsightDraft, InsightFact, Kopecks, LocalDate, ObjectStatus, TurnReasonKind } from "@impuls/core";

/** Why the daily turn runs: a finding of the morning evaluation the last turn did not see (ad-agent spec «Поводы для хода агента»). */
export interface TurnReasonView {
  kind: TurnReasonKind;
  objectKind: "ad" | "direction" | "hypothesis";
  objectId: string;
}

/** Events that run a turn of their own in Direct; in a simulation they join the period's turn. */
export type EventTrigger =
  | { kind: "launch" }
  | { kind: "moderation_rejected"; adIds: string[] }
  | { kind: "experiment_finished"; experimentIds: string[] }
  | { kind: "settings_changed" };

export type TurnTrigger =
  | EventTrigger
  | { kind: "daily_review"; reasons?: TurnReasonView[] }
  /** Monday 07:00: the weekly strategic review on the strategy model (add-agent-analyst-stage1 decision 7). */
  | { kind: "weekly_review" }
  /**
   * The one turn after a period of stats a simulation's owner entered, whatever its length (ad-agent spec «Разбор
   * периода в симуляции»): the days `from`–`to`, the evaluation's reasons and the events since the last turn.
   */
  | { kind: "period_review"; from: LocalDate; to: LocalDate; reasons?: TurnReasonView[]; events?: EventTrigger[] };

/**
 * Turn snapshot. Built only from the allowlisted fields below — no personal data, no tokens (ad-agent spec).
 * `facts` is the catalog the agent cites in insights by key (insights spec «Факты проверяются по данным»).
 */
export interface TurnSnapshot {
  today: LocalDate;
  business: { category: string; services: { name: string; priceRub: number | null }[]; area: string; hours: string; advantages: string[] };
  goal: { costPerLeadRub: number; mode: "user" | "auto" };
  budget: { monthRub: number; spentRub: number; leftRub: number; evenPaceRub: number };
  strategyCatalog: { id: string; title: string }[];
  directions: {
    id: string;
    name: string;
    status: ObjectStatus;
    weeklyLimitRub: number;
    strategyId: string;
    class: EffectivenessClass;
    spend14Rub: number;
    leads14: number;
    /** Spend of the last 7 days: close to `weeklyLimitRub` means the direction is held back by its limit. */
    spend7Rub: number;
  }[];
  ads: { id: string; directionId: string; status: ObjectStatus; title: string; text: string; class: EffectivenessClass; spend14Rub: number; leads14: number }[];
  /** The running A/B check, if any. */
  experiment: { adId: string; variantAdId: string | null; hypothesis: string; startedOn: LocalDate } | null;
  userDecisions: { objectId: string; action: Command["type"]; on: LocalDate }[];
  facts: InsightFact[];
}

/** An observation without an action: why nothing changes now (`report_insight`). */
export type ObservationDraft = InsightDraft & { decision: string };

/** An insight of the last 14 days as the agent reads it back (`get_recent_insights`). */
export interface RecentInsight {
  at: string;
  observation: string;
  decision: string;
  facts: { object: string; metric: string; period: string; value: number }[];
}

export type ToolResult =
  | { status: "applied"; message: string }
  | { status: "clamped"; message: string }
  | { status: "rejected"; code: string; message: string };

export type BreakdownDimensionName = "query" | "device";

/**
 * A breakdown row as the agent reads it (add-agent-analyst-stage1 decision 1): money in whole rubles and the verdict of
 * the service's code. Fact keys of the row are `factKeyPrefix` + `:<metric>:14d`.
 */
export interface BreakdownRowView {
  /** The search query (filtered before it reaches the model) or the device in the owner's words. */
  segment: string;
  factKeyPrefix: string;
  impressions: number;
  clicks: number;
  spendRub: number;
  leads: number;
  costPerLeadRub: number | null;
  /** «собираем данные», «в цели» or «дороже цели». */
  verdict: string;
}

export type BreakdownAnswer =
  | {
      status: "ok";
      directionId: string;
      dimension: BreakdownDimensionName;
      days: number;
      rows: BreakdownRowView[];
      hidden: number;
      /** Queries only: the direction's own key phrases (never cut them) and its negative phrases. */
      keywords?: string[];
      negativeKeywords?: string[];
      /** Devices only: the current adjustments in percent and the day each last changed (one change in 7 days). */
      adjustments?: Record<"mobile" | "desktop", { percent: number; changedOn: LocalDate | null }>;
    }
  | { status: "rejected"; code: string; message: string };

export type HypothesisStatusName = "checking" | "confirmed" | "rejected" | "dropped";

/** A new hypothesis (without `id`) or a change of an open one (ad-agent spec «Журнал гипотез»). */
export interface HypothesisDraft {
  id?: string;
  statement: string;
  factKeys: string[];
  check: string;
  checkOn: LocalDate;
  status: HypothesisStatusName;
  /** Required when the hypothesis is closed: what came out, with numbers from `factKeys`. */
  result?: string;
}

/** A hypothesis of the journal as the agent reads it back (`get_hypotheses`). */
export interface HypothesisView {
  id: string;
  statement: string;
  check: string;
  checkOn: LocalDate;
  status: HypothesisStatusName;
  result: string | null;
  openedOn: LocalDate;
  closedOn: LocalDate | null;
  facts: { object: string; metric: string; period: string; value: number }[];
}

export type HypothesisResult = { status: "applied"; message: string; id: string } | { status: "rejected"; code: string; message: string };

/** Tools are bound to the turn's business on the server; arguments never select the business. */
export interface AgentToolbox {
  /** An action with its insight; the insight is checked before anything is executed. */
  act(command: Command, insight: InsightDraft): Promise<ToolResult>;
  /** An insight without an action. */
  observe(insight: ObservationDraft): Promise<ToolResult>;
  recentInsights(): Promise<RecentInsight[]>;
  /** A breakdown of one direction over 14 days; its facts join the turn's catalog. */
  breakdown(directionId: string, dimension: BreakdownDimensionName): Promise<BreakdownAnswer>;
  /** Open hypotheses and those closed in the last 14 days. */
  hypotheses(): Promise<HypothesisView[]>;
  saveHypothesis(draft: HypothesisDraft): Promise<HypothesisResult>;
}

export interface ToolCallRecord {
  /** null for an observation without an action. */
  command: Command | null;
  insight: InsightDraft;
  result: ToolResult;
}

/** Token usage of a turn: from the Agents API, or the runtime's estimate with a margin when the API has none. */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  source: "api" | "estimate";
}

export interface TurnResult {
  /** How many times the agent called each tool, reads included: what a long turn spent its steps on. */
  toolUse?: Record<string, number>;
  /** The message to the owner, shown as «Разбор дня» once it passes the checks. */
  summary: string;
  calls: ToolCallRecord[];
  /** null when no model was called (test policies). */
  usage: TurnUsage | null;
}

/** Port for the agent "brain": OpenAI Agents API in production, policies and replay in tests. */
export interface AgentRuntime {
  readonly name: string;
  readonly instructionsVersion: string;
  /**
   * Whether this runtime makes decisions. The safety net waits for an agent only after a turn of a deciding runtime;
   * `IdlePolicy` decides nothing, so the rules act at once (add-agent-insights decision 5).
   */
  readonly decides: boolean;
  runTurn(input: { trigger: TurnTrigger; snapshot: TurnSnapshot; tools: AgentToolbox; signal: AbortSignal }): Promise<TurnResult>;
}

export const toRub = (kopecks: Kopecks): number => Math.round(kopecks / 100);
