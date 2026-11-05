import "server-only";
import { savedPeriodForm } from "@impuls/worker";
import { simulationStatusOf } from "../simulation-model";
import type { SimulationStatus } from "../simulation-model";
import { store } from "./runtime";

/** The player's model of a simulated business, or null for a business working with Direct. */
export const buildSimulationStatus = async (businessId: string): Promise<SimulationStatus | null> => {
  const s = store();
  const simulation = await s.getSimulation(businessId);
  if (simulation === null) {
    return null;
  }
  const [business, changes, runningTurn, directions, ads] = await Promise.all([s.getBusiness(businessId), s.changes(businessId), s.runningTurn(businessId), s.directions(businessId), s.ads(businessId)]);
  const form = savedPeriodForm(simulation, directions, ads, business.timeZone);
  return simulationStatusOf({ simulation, timeZone: business.timeZone, changes: changes.length, runningTurn, form });
};
