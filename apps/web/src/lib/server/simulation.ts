import "server-only";
import { simulationStatusOf } from "../simulation-model";
import type { SimulationStatus } from "../simulation-model";
import { store } from "./runtime";

/** The pult model of a simulated business, or null for a business working with Direct. */
export const buildSimulationStatus = async (businessId: string): Promise<SimulationStatus | null> => {
  const s = store();
  const simulation = await s.getSimulation(businessId);
  if (simulation === null) {
    return null;
  }
  const [business, changes, runningTurnStartedAt, turns] = await Promise.all([s.getBusiness(businessId), s.changes(businessId), s.runningTurnStartedAt(businessId), s.turnDigests(businessId)]);
  return simulationStatusOf({ simulation, timeZone: business.timeZone, changes: changes.length, runningTurnStartedAt, turns });
};
