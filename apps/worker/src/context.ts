import type { AgentRuntime, CreativeEngine } from "@impuls/agent";
import type { AdPlatform } from "@impuls/platforms";
import type { Clock } from "./clock";
import type { CommandExecutor } from "./executor";
import type { LockManager } from "./locks";
import type { Store } from "./store";

/** Price of the model and spend limits (ad-agent spec «Лимиты агента»); kopecks. */
export interface AgentCosts {
  inputKopecksPerMTok: number;
  outputKopecksPerMTok: number;
  monthlyLimitKopecks: number;
  simulationRunLimitKopecks: number;
}

/** Everything a job handler needs. Handlers are independent of how they are scheduled (design decision 2). */
export interface JobContext {
  store: Store;
  clock: Clock;
  locks: LockManager;
  executor: CommandExecutor;
  platformFor: (businessId: string) => AdPlatform;
  agent: AgentRuntime;
  /** Set for a runtime that calls a model; test policies cost nothing and have no limits. */
  agentCosts?: AgentCosts;
  /**
   * The weekly review's runtime and its prices when a separate strategy model is configured; without it the review
   * runs on `agent` (add-agent-analyst-stage1 decision 7). Its spend counts in the same limits.
   */
  strategist?: { runtime: AgentRuntime; costs: AgentCosts };
  /** Card extraction and ad texts (ad-creatives spec); template or LLM, chosen by configuration. */
  creatives: CreativeEngine;
}
