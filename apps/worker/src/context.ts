import type { AgentRuntime } from "@impuls/agent";
import type { AdPlatform } from "@impuls/platforms";
import type { Clock } from "./clock";
import type { CommandExecutor } from "./executor";
import type { LockManager } from "./locks";
import type { Store } from "./store";

/** Everything a job handler needs. Handlers are independent of how they are scheduled (design decision 2). */
export interface JobContext {
  store: Store;
  clock: Clock;
  locks: LockManager;
  executor: CommandExecutor;
  platformFor: (businessId: string) => AdPlatform;
  agent: AgentRuntime;
}
