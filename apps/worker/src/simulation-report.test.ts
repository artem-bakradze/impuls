import { describe, expect, it } from "vitest";
import { isStepComplete, readSimulationSteps, readWeekReport } from "./simulation-report";
import type { SimulationWeekReport } from "./simulation-report";

const report: SimulationWeekReport = { version: 1, at: "2026-11-08T06:00:00.000Z", endsAt: "2026-12-01T06:00:00.000Z", baseline: null, cso: 50000, monthlyBudgetRub: 15000, stats: [], directions: [], ads: [], changes: [], insights: [], hypotheses: [], truths: [], fullDaily: [], turns: [{ id: "turn", startedAt: new Date("2026-11-08T04:00:00Z"), status: "completed", trigger: "weekly_review", summary: "Собираем данные", summaryValid: true, usageSource: null }] };
describe("simulation step persistence", () => {
  it("round-trips step and report dates without discarding completion metadata", () => {
    const steps = [{ kind: "week", from: new Date("2026-11-01T06:00:00Z"), to: new Date(report.at), completedAt: new Date(report.at), state: "completed", report: JSON.stringify(report) }];
    const restored = readSimulationSteps(JSON.parse(JSON.stringify(steps)));
    expect(restored).toEqual(steps);
    expect(readWeekReport(restored[0]?.report ?? "").turns[0]?.startedAt).toEqual(report.turns[0]?.startedAt);
  });
  it("keeps a period's marks and the directions' settings through the database (simulation-breakdowns)", () => {
    const steps = [
      {
        kind: "period",
        from: new Date("2026-11-01T06:00:00Z"),
        to: new Date(report.at),
        days: 7,
        input: [{ adId: "a1", impressions: 1_400, clicks: 70, leads: 7, spendRub: 2_000 }],
        market: { junkQuery: true, phonesWorse: false },
        traffic: { d1: { keywords: ["маникюр"], negativeKeywords: ["курсы"], deviceAdjustments: { mobile: -25, desktop: 0 } } },
        recorded: true,
        state: "running",
      },
    ];
    expect(readSimulationSteps(JSON.parse(JSON.stringify(steps)))).toEqual(steps);
  });
  it("recognizes completed legacy windows but never a future target or running window", () => {
    const [legacy] = readSimulationSteps([{ kind: "week", from: "2026-11-01T06:00:00Z", to: report.at }]);
    if (!legacy) throw new Error("Missing fixture");
    expect(isStepComplete(legacy, { simNow: new Date("2026-11-04"), status: "stepping", steps: [legacy] })).toBe(false);
    expect(isStepComplete(legacy, { simNow: new Date(report.at), status: "stepping", steps: [legacy] })).toBe(false);
    expect(isStepComplete(legacy, { simNow: new Date(report.at), status: "stepping", steps: [legacy, { kind: "week", from: legacy.to, to: new Date("2026-11-15T06:00:00Z") }] })).toBe(true);
    expect(isStepComplete(legacy, { simNow: new Date(report.at), status: "paused", steps: [legacy] })).toBe(true);
    expect(isStepComplete({ ...legacy, state: "running" }, { simNow: new Date(report.at), status: "stepping", steps: [legacy] })).toBe(false);
  });
  it("rejects completed steps without a report and incompatible or malformed reports", () => {
    expect(() => readSimulationSteps([{ kind: "week", from: report.at, to: report.at, state: "completed", completedAt: report.at }])).toThrow("no saved result");
    expect(() => readWeekReport(JSON.stringify({ ...report, version: 2 }))).toThrow();
    expect(() => readWeekReport(JSON.stringify({ ...report, turns: [{ id: "turn", startedAt: "not a date" }] }))).toThrow();
  });
});
