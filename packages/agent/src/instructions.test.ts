import { describe, expect, it } from "vitest";
import { AGENT_INSTRUCTIONS_VERSION, instructionsFor, PERIOD_REVIEW_INSTRUCTIONS } from "./instructions";

describe("the period review's instructions (simulation-breakdowns)", () => {
  it("ask for the breakdowns of every direction with spend and to act on them, with a version of their own", () => {
    const period = instructionsFor({ kind: "period_review", from: "2026-11-01", to: "2026-11-07", reasons: [], events: [] });
    expect(period.text).toContain(PERIOD_REVIEW_INSTRUCTIONS);
    expect(PERIOD_REVIEW_INSTRUCTIONS).toContain("Запроси get_breakdown по каждому направлению с расходом");
    expect(PERIOD_REVIEW_INSTRUCTIONS).toContain("по сегменту «собираем данные» ничего не меняй");
    expect(PERIOD_REVIEW_INSTRUCTIONS).not.toContain("Разбивки по запросам и устройствам может не быть");
    expect(period.version).toBe(`${AGENT_INSTRUCTIONS_VERSION}+period.2026-11-06.1`);
  });
});
