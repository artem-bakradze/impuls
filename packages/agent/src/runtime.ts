import type { Command, EffectivenessClass, Kopecks, LocalDate, ObjectStatus } from "@impuls/core";

export type TurnTrigger =
  | { kind: "launch" }
  | { kind: "daily_review" }
  | { kind: "moderation_rejected"; adIds: string[] }
  | { kind: "experiment_finished"; experimentIds: string[] }
  | { kind: "settings_changed" };

/**
 * Turn snapshot. Built only from the allowlisted fields below — no personal data, no tokens (ad-agent spec).
 */
export interface TurnSnapshot {
  today: LocalDate;
  business: { category: string; services: { name: string; priceRub: number | null }[]; area: string; hours: string; advantages: string[] };
  goal: { costPerLeadRub: number; mode: "user" | "auto" };
  budget: { monthRub: number; spentRub: number };
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
  }[];
  ads: { id: string; directionId: string; status: ObjectStatus; title: string; text: string; class: EffectivenessClass; spend14Rub: number; leads14: number }[];
  userDecisions: { objectId: string; action: Command["type"]; on: LocalDate }[];
  notes: string[];
}

export interface Justification {
  reasonCode: string;
  /** Explanation for the business owner; every number must match the snapshot. */
  text: string;
}

export type ToolResult =
  | { status: "applied"; message: string }
  | { status: "clamped"; message: string }
  | { status: "rejected"; code: string; message: string };

/** Tools are bound to the turn's business on the server; arguments never select the business. */
export interface AgentToolbox {
  act(command: Command, justification: Justification): Promise<ToolResult>;
  saveNote(text: string): Promise<void>;
}

export interface ToolCallRecord {
  command: Command;
  justification: Justification;
  result: ToolResult;
}

export interface TurnResult {
  summary: string;
  calls: ToolCallRecord[];
}

/** Port for the agent "brain": OpenAI Agents API in production, policies and replay in tests. */
export interface AgentRuntime {
  readonly name: string;
  readonly instructionsVersion: string;
  runTurn(input: { trigger: TurnTrigger; snapshot: TurnSnapshot; tools: AgentToolbox; signal: AbortSignal }): Promise<TurnResult>;
}

export const toRub = (kopecks: Kopecks): number => Math.round(kopecks / 100);
