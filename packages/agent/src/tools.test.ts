import { describe, expect, it } from "vitest";
import { parseActionCall, toolDefinitions } from "./tools";

describe("tool definitions", () => {
  it("expose JSON-schema parameters and never accept a business ID", () => {
    const tools = toolDefinitions();
    expect(tools.length).toBe(15);
    for (const tool of tools) {
      const schema = tool.parameters as { type: string; properties: Record<string, unknown>; additionalProperties: boolean };
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties)).not.toContain("businessId");
    }
  });

  it("require a justification for every action tool", () => {
    for (const tool of toolDefinitions().filter((t) => !["save_note", "delete_note", "get_snapshot", "get_history", "get_notes"].includes(t.name))) {
      expect((tool.parameters as { required: string[] }).required).toContain("justification");
    }
  });
});

describe("parseActionCall", () => {
  const justification = { reasonCode: "SCALE", text: "Выделил больше денег направлению, которое приводит клиентов дешевле цели." };

  it("converts rubles to kopecks", () => {
    expect(parseActionCall("set_spend_limit", { directionId: "d1", weeklyLimitRub: 3_360, justification })).toEqual({
      ok: true,
      command: { type: "SetSpendLimit", directionId: "d1", weeklyLimit: 336_000 },
      justification,
    });
  });

  it("rejects a call without justification", () => {
    expect(parseActionCall("pause_ad", { adId: "a1" })).toEqual({ ok: false, message: "нужно обоснование: код причины и текст для владельца бизнеса" });
  });

  it("rejects extra arguments such as a business ID", () => {
    expect(parseActionCall("pause_ad", { adId: "a1", businessId: "other", justification }).ok).toBe(false);
  });

  it("rejects unknown tools and too long ad texts", () => {
    expect(parseActionCall("delete_campaign", {}).ok).toBe(false);
    expect(parseActionCall("update_ad_text", { adId: "a1", title: "x".repeat(57), text: "ok", justification }).ok).toBe(false);
  });
});
