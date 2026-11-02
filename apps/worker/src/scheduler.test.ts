import { CreativesError } from "@impuls/agent";
import { describe, expect, it } from "vitest";
import { describeError } from "./scheduler";
import { CreativeJobError } from "./web-jobs";

describe("web job failure log", () => {
  it("keeps the technical reason behind the owner's message", () => {
    const cause = new CreativesError("NOT_ENOUGH_ADS", "Only 2 search ads passed the checks; rejected: NO_FACT, NO_FACT");
    const error = new CreativeJobError("CREATIVES_FAILED", "Не получилось подготовить объявления. Попробуйте ещё раз через минуту", { cause });
    expect(describeError(error)).toEqual([
      { name: "CreativeJobError", code: "CREATIVES_FAILED", message: "Не получилось подготовить объявления. Попробуйте ещё раз через минуту" },
      { name: "CreativesError", code: "NOT_ENOUGH_ADS", message: "Only 2 search ads passed the checks; rejected: NO_FACT, NO_FACT" },
    ]);
    expect(describeError("boom")).toEqual([{ name: "NonError", code: null, message: "boom" }]);
  });
});
