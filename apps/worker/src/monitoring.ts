import type { Clock } from "./clock";
import { HEARTBEAT_BUDGET_GUARD, HEARTBEAT_DISPATCHER, HEARTBEAT_RECONCILIATION } from "./jobs";
import type { FlagName, Store } from "./store";

export const HEARTBEAT_MAX_AGE_MS = 2 * 3_600_000;
const WATCHED = [HEARTBEAT_BUDGET_GUARD, HEARTBEAT_RECONCILIATION, HEARTBEAT_DISPATCHER] as const;

export interface HealthReport {
  ok: boolean;
  stale: string[];
}

/**
 * Backs the `/health` endpoint polled by the external monitor: fails when budget guard,
 * reconciliation or the dispatcher has not completed for 2 hours, and opens an incident.
 */
export const checkHealth = async (store: Store, clock: Clock): Promise<HealthReport> => {
  const now = clock.now().getTime();
  const stale: string[] = [];
  for (const name of WATCHED) {
    const last = await store.lastBeat(name);
    if (last === null || now - last.getTime() > HEARTBEAT_MAX_AGE_MS) {
      stale.push(name);
    }
  }
  if (stale.length > 0) {
    await store.openIncident({ kind: "heartbeat_stale", businessId: null, message: `Stale heartbeats: ${stale.join(", ")}`, openedAt: clock.now() });
  }
  return { ok: stale.length === 0, stale };
};

/** Kill switch used by the ops CLI; takes effect on the next job or tool call. */
export const setKillSwitch = (store: Store, name: FlagName, enabled: boolean, businessId: string | null): Promise<void> =>
  store.setFlag(name, enabled, businessId);
