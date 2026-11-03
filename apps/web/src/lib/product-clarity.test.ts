import { describe, expect, it } from "vitest";
import { SimulatedPlatform } from "@impuls/platforms";
import type { SimulationRecord } from "@impuls/worker";
import { buildDecisionScreen } from "./simulation-screen";
import { measurementFromCard, measurementState, measurementText } from "./measurement";

const simulation = (now: string, start = "2026-11-01T06:00:00Z"): SimulationRecord => ({
  businessId: "b", scenario: "regular", seed: 1, plan: { city: "Москва", landingUrl: "https://example.test", directions: [] }, startedAt: new Date(start), simNow: new Date(now), endsAt: new Date(new Date(start).getTime() + 30 * 86400000), lastTickAt: null, speed: 0, status: "paused", steps: [], replay: null,
  state: new SimulatedPlatform({ seed: 1, timeZone: "Europe/Moscow", now: () => new Date(start), truthFor: () => ({ impressionsPerDay: 100, ctr: 0.05, cr: 0.05, costPerClick: 2000 }) }).snapshot(),
  baseline: { days: 30, spend: 300000, leads: 30, daily: Array.from({ length: 30 }, () => ({ spend: 10000, leads: 1 })) },
});
const screen = (now: string, timeZone = "Europe/Moscow", start?: string) => buildDecisionScreen({ simulation: simulation(now, start), timeZone, monthlyBudgetRub: 15000, directions: [], changes: [] });
describe("complete calendar days in comparisons", () => {
  it("waits on launch day and excludes the 8th day's morning", () => {
    expect(screen("2026-11-01T18:00:00Z").comparison).toBeNull();
    expect(screen("2026-11-08T06:00:00Z").comparison?.baseline).toHaveLength(7);
    expect(screen("2026-11-08T06:00:00Z").comparison?.to).toBe("2026-11-07");
  });
  it("uses the business's calendar across a UTC date boundary and month end", () => {
    expect(screen("2026-11-08T01:00:00Z", "America/Los_Angeles", "2026-11-01T17:00:00Z").comparison?.baseline).toHaveLength(6);
    expect(screen("2026-12-01T06:00:00Z").comparison?.baseline).toHaveLength(30);
    expect(screen("2026-12-01T06:00:00Z").comparison?.to).toBe("2026-11-30");
  });
  it("preserves an unfavorable result and keeps unknown price unknown", () => {
    const model = screen("2026-12-01T06:00:00Z");
    expect(model.result?.service.leads).toBe(0); expect(model.result?.baseline.leads).toBe(30);
    expect(model.result?.service.costPerLead).toBeNull();
  });
});
describe("measurement states", () => {
  it.each(["not_found", "unreachable"] as const)("preserves %s after launch and invalidates it when the site changes", (status) => {
    const card = { siteUrl: "https://example.test", measurement: { siteUrl: "https://example.test", status, counterId: null } };
    expect(measurementFromCard(card, false).status).toBe(status);
    expect(measurementFromCard({ ...card, siteUrl: "https://new.test" }, false).status).toBe("unchecked");
  });
  it("supports legacy checks and never calls a found counter confirmed events", () => {
    const state = measurementFromCard({ siteUrl: "https://example.test", onboarding: { counter: { siteUrl: "https://example.test", status: "found", counterId: 123 } } }, false);
    expect(measurementText(state).detail).toContain("пока не подтверждено");
    expect(measurementText(measurementState(null, true)).title).toBe("Учебные обращения");
  });
});
