import { describe, expect, it } from "vitest";
import { AGENT_INSTRUCTIONS_VERSION, instructionsFor, PERIOD_REVIEW_INSTRUCTIONS } from "./instructions";

describe("the period review's instructions (simulation-breakdowns)", () => {
  it("ask for the breakdowns of every direction with spend and to act on them, with a version of their own", () => {
    const period = instructionsFor({ kind: "period_review", from: "2026-11-01", to: "2026-11-07", reasons: [], events: [] });
    expect(period.text).toContain(PERIOD_REVIEW_INSTRUCTIONS);
    expect(PERIOD_REVIEW_INSTRUCTIONS).toContain("Запроси get_breakdown по каждому направлению с расходом");
    expect(PERIOD_REVIEW_INSTRUCTIONS).toContain("по сегменту «собираем данные» ничего не меняй");
    expect(PERIOD_REVIEW_INSTRUCTIONS).not.toContain("Разбивки по запросам и устройствам может не быть");
    expect(period.version).toBe(`${AGENT_INSTRUCTIONS_VERSION}+period.2026-11-07.2`);
  });

  it("ask for a first-person story without a label, with the cost per lead as the owner sees it before any slice", () => {
    expect(PERIOD_REVIEW_INSTRUCTIONS).toContain("рассказ от первого лица о том, что ты делал в этом разборе, по порядку");
    expect(PERIOD_REVIEW_INSTRUCTIONS).toContain("без ярлыков вроде «Разбор периода:»");
    expect(PERIOD_REVIEW_INSTRUCTIONS).toContain("перебери для себя два-три возможных объяснения и выбери одно");
    expect(PERIOD_REVIEW_INSTRUCTIONS).toContain("Цену обращения среза не сравнивай с целью так, будто это итог всей рекламы");
    expect(PERIOD_REVIEW_INSTRUCTIONS).toContain("сначала по всей рекламе за эти дни (факты total:all:…:period)");
    // The example has no figures: a number in it is not in the facts of a turn.
    const example = /Например: «([^»]+)»/.exec(PERIOD_REVIEW_INSTRUCTIONS)?.[1] ?? "";
    expect(example).not.toBe("");
    expect(example).not.toMatch(/\d/);
  });
});
