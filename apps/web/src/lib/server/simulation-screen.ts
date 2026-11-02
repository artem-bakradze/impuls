import "server-only";
import { buildDecisionScreen, scenarioTruth } from "../simulation-screen";
import type { DecisionScreen } from "../simulation-screen";
import { buildInsightFeed } from "./insights";
import { store } from "./runtime";

/** «Как сервис принимает решения» of a simulated business; null for a business working with Direct. */
export const loadDecisionScreen = async (businessId: string): Promise<DecisionScreen | null> => {
  const s = store();
  const simulation = await s.getSimulation(businessId);
  if (simulation === null) {
    return null;
  }
  const business = await s.getBusiness(businessId);
  const [directions, ads, changes] = await Promise.all([s.directions(businessId), s.ads(businessId), s.changes(businessId)]);
  const goal = business.csoSource.kind === "user" ? business.csoSource.goal : business.csoSource.reference;
  const model = buildDecisionScreen({ simulation, timeZone: business.timeZone, monthlyBudgetRub: business.monthlyBudgetRub, directions, changes });
  // The whole run: the screen is the story of the simulation.
  const feed = await buildInsightFeed(businessId, { since: null, truthOf: scenarioTruth({ simulation, ads, goal }) });
  return { ...model, feed };
};
