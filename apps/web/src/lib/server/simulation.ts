import "server-only";
import { savedPeriodForm } from "@impuls/worker";
import { changeHeadline } from "../service-work";
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
  // The running review's changes in the history's words, for its steps on the player.
  const stepChanges = new Set((runningTurn?.steps ?? []).flatMap((step) => (step.kind === "change" ? [step.changeId] : [])));
  const directionMap = new Map(directions.map((d) => [d.id, d]));
  const adTitles = new Map(ads.map((a) => [a.id, a.title]));
  const headlines = new Map(
    changes.filter((c) => stepChanges.has(c.id)).flatMap((c) => {
      const words = changeHeadline(c, directionMap, adTitles);
      return words === null ? [] : [[c.id, words] as const];
    }),
  );
  return simulationStatusOf({ simulation, timeZone: business.timeZone, changes: changes.length, runningTurn, form, headlines });
};
