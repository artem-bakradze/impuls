import { describe, expect, it } from "vitest";
import { isActionTool, parseActionCall, parseHypothesisCall, parseObservationCall, toolDefinitions } from "./tools";

describe("tool definitions", () => {
  it("expose JSON-schema parameters and never accept a business ID", () => {
    const tools = toolDefinitions();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["get_snapshot", "get_history", "get_recent_insights", "report_insight", "get_breakdown", "get_hypotheses", "save_hypothesis"]),
    );
    expect(tools.length).toBe(18);
    for (const tool of tools) {
      const schema = tool.parameters as { type: string; properties: Record<string, unknown>; additionalProperties: boolean };
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties)).not.toContain("businessId");
    }
  });

  it("require an insight for every action tool (ad-agent spec «Обоснование каждого действия»)", () => {
    for (const tool of toolDefinitions().filter((t) => isActionTool(t.name))) {
      expect((tool.parameters as { required: string[] }).required).toContain("insight");
    }
    const report = toolDefinitions().find((t) => t.name === "report_insight")?.parameters as { required: string[] };
    expect(report.required).toEqual(expect.arrayContaining(["observation", "factKeys", "decision", "next"]));
  });
});

describe("parseActionCall", () => {
  const insight = {
    reasonCode: "SCALE",
    observation: "Реклама в поиске приводит клиентов дешевле цели.",
    factKeys: ["direction:d1:cost_per_lead:14d", "goal:goal:now"],
    next: "Через неделю проверим число обращений.",
  };

  it("converts rubles to kopecks", () => {
    expect(parseActionCall("set_spend_limit", { directionId: "d1", weeklyLimitRub: 3_360, insight })).toEqual({
      ok: true,
      command: { type: "SetSpendLimit", directionId: "d1", weeklyLimit: 336_000 },
      insight,
    });
  });

  it("rejects a call without an insight or with too few facts", () => {
    const message = "нужен инсайт: что заметили, 2–4 факта из снимка и что дальше";
    expect(parseActionCall("pause_ad", { adId: "a1" })).toEqual({ ok: false, message });
    expect(parseActionCall("pause_ad", { adId: "a1", insight: { ...insight, factKeys: ["goal:goal:now"] } })).toEqual({ ok: false, message });
  });

  it("rejects extra arguments such as a business ID", () => {
    expect(parseActionCall("pause_ad", { adId: "a1", businessId: "other", insight }).ok).toBe(false);
  });

  it("rejects unknown tools and too long ad texts", () => {
    expect(parseActionCall("delete_campaign", {}).ok).toBe(false);
    expect(parseActionCall("update_ad_text", { adId: "a1", title: "x".repeat(57), text: "ok", insight }).ok).toBe(false);
  });

  it("parses the analyst levers (add-agent-analyst-stage1)", () => {
    expect(parseActionCall("add_negative_keywords", { directionId: "d1", phrases: ["бесплатно"], insight })).toEqual({
      ok: true,
      command: { type: "AddNegativeKeywords", directionId: "d1", phrases: ["бесплатно"] },
      insight,
    });
    expect(parseActionCall("add_negative_keywords", { directionId: "d1", phrases: [], insight }).ok).toBe(false);
    expect(parseActionCall("set_device_adjustment", { directionId: "d1", device: "mobile", percent: -30, insight })).toEqual({
      ok: true,
      command: { type: "SetDeviceAdjustment", directionId: "d1", device: "mobile", percent: -30 },
      insight,
    });
    // Tablets go with computers in Direct: there is no separate lever for them.
    expect(parseActionCall("set_device_adjustment", { directionId: "d1", device: "tablet", percent: -30, insight }).ok).toBe(false);
  });

  it("parses a hypothesis: a new one without id, a closing one with the result", () => {
    const draft = { statement: "С телефонов клиенты обходятся дороже", factKeys: ["a", "b"], check: "Сравним через неделю", checkOn: "2026-11-09", status: "checking" };
    expect(parseHypothesisCall(draft)).toEqual({ ok: true, draft });
    expect(parseHypothesisCall({ ...draft, id: "h1", status: "confirmed", result: "Подтвердилась" })).toEqual({
      ok: true,
      draft: { ...draft, id: "h1", status: "confirmed", result: "Подтвердилась" },
    });
    expect(parseHypothesisCall({ ...draft, checkOn: "через неделю" }).ok).toBe(false);
    expect(parseHypothesisCall({ ...draft, businessId: "other" }).ok).toBe(false);
  });

  it("parses an observation without an action", () => {
    const observation = { ...insight, decision: "Пока ничего не меняем: данных мало." };
    expect(parseObservationCall(observation)).toEqual({ ok: true, insight: observation });
    expect(parseObservationCall({ ...insight }).ok).toBe(false);
  });
});
