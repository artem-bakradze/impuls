import { describe, expect, it } from "vitest";
import { measurementFromCard, measurementState, measurementText } from "./measurement";

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
