import { toLocalDate } from "@impuls/core";
import type { LocalDate } from "@impuls/core";
import type { SimulationRecord } from "@impuls/worker";
import { isStepComplete } from "@impuls/worker/simulation-report";

/**
 * The lived periods of a simulation as sections of its history (simulation-mode spec «История периодов»), numbered
 * from 1, with the weeks of older runs among them: the days from a step's first date to the day before the morning it
 * ends on, and that morning — the review of those days — belongs to it too (`reviewedOn`). Days lived one by one in
 * older runs make no section.
 */
export const livedPeriods = (simulation: SimulationRecord, timeZone: string): { week: number; from: LocalDate; reviewedOn: LocalDate; period: boolean }[] =>
  simulation.steps
    .filter((s) => s.kind !== "day" && isStepComplete(s, simulation))
    .map((s, index) => ({ week: index + 1, from: toLocalDate(s.from, timeZone), reviewedOn: toLocalDate(s.to, timeZone), period: s.kind === "period" }));
