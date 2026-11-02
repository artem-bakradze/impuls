import "server-only";
import { isAdDecision, speedName } from "@impuls/worker";
import type { SimulationStatus } from "../simulation-model";
import { store } from "./runtime";

const DAY_MS = 86_400_000;

/** The pult model of a simulated business, or null for a business working with Direct. */
export const buildSimulationStatus = async (businessId: string): Promise<SimulationStatus | null> => {
  const s = store();
  const simulation = await s.getSimulation(businessId);
  if (simulation === null) {
    return null;
  }
  const [business, changes, turnStartedAt] = await Promise.all([s.getBusiness(businessId), s.changes(businessId), s.runningTurnStartedAt(businessId)]);
  const elapsed = simulation.simNow.getTime() - simulation.startedAt.getTime();
  const totalDays = Math.round((simulation.endsAt.getTime() - simulation.startedAt.getTime()) / DAY_MS);
  const dayOf = (at: Date) => Math.min(totalDays, Math.floor((at.getTime() - simulation.startedAt.getTime()) / DAY_MS) + 1);
  // The newest decision about the ads, as «До следующего решения» stops on (budget-guard limit cuts are not decisions).
  const decision = [...changes].reverse().find(isAdDecision);
  return {
    day: dayOf(new Date(simulation.startedAt.getTime() + elapsed)),
    totalDays,
    at: simulation.simNow.toISOString(),
    timeZone: business.timeZone,
    status: simulation.status,
    speed: speedName(simulation.speed),
    ended: simulation.simNow.getTime() + 3_600_000 > simulation.endsAt.getTime(),
    changes: changes.length,
    lastDecision: decision ? { id: decision.id, explanation: decision.explanation } : null,
    agentTurn: turnStartedAt ? { day: dayOf(turnStartedAt) } : null,
  };
};
