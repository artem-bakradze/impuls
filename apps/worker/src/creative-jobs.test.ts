import { IdlePolicy, LlmCreativeEngine, ScriptedLlmClient } from "@impuls/agent";
import type { CardFacts } from "@impuls/agent";
import { describe, expect, it } from "vitest";
import { SimulationDriver } from "./simulation";
import { handleWebJob } from "./web-jobs";

const withLlm = (answers: Record<string, unknown[]>) => {
  const sim = new SimulationDriver({ start: new Date("2026-10-29T09:00:00Z"), seed: 1, agent: new IdlePolicy() });
  const llm = new ScriptedLlmClient(answers);
  return { ctx: { ...sim.ctx, creatives: new LlmCreativeEngine(llm) }, llm };
};

const card = {
  name: "Прана",
  category: "Студия йоги",
  services: [{ name: "Хатха-йога", priceRub: 900 }],
  address: "Санкт-Петербург, Невский проспект, 100",
  days: "Пн–Пт",
  openFrom: "08:00",
  openTo: "21:00",
  phone: null,
  advantages: ["Группы до 8 человек"],
};

const sources = (patch: Partial<{ siteUrl: string; mapsUrl: string; vkUrl: string; about: string }>) => ({ siteUrl: "", mapsUrl: "", vkUrl: "", about: "", ...patch });

describe("extract_card job", () => {
  it("extracts the card from the owner's own words when there is no link", async () => {
    const { ctx, llm } = withLlm({ extract_card: [card] });
    const result = await handleWebJob(ctx, { kind: "extract_card", businessId: "b1", sources: sources({ about: "Студия йоги Прана на Невском, 100. Хатха-йога 900 ₽" }) });
    expect(result).toEqual({ card, unreadable: [] });
    expect(llm.requests[0]?.input).toBe("### about\nСтудия йоги Прана на Невском, 100. Хатха-йога 900 ₽");
  });

  it("reports a page it could not read and still uses the description", async () => {
    const { ctx } = withLlm({ extract_card: [card] });
    const result = await handleWebJob(ctx, { kind: "extract_card", businessId: "b1", sources: sources({ siteUrl: "http://127.0.0.1:9/", about: "Йога на Невском" }) });
    expect(result).toMatchObject({ unreadable: ["site"] });
  });

  it("says «Не получилось прочитать страницу» when nothing could be read", async () => {
    const { ctx, llm } = withLlm({});
    await expect(handleWebJob(ctx, { kind: "extract_card", businessId: "b1", sources: sources({ siteUrl: "http://10.0.0.1/" }) })).rejects.toMatchObject({
      code: "CARD_UNREADABLE",
      message: "Не получилось прочитать страницу — расскажите о бизнесе своими словами",
    });
    expect(llm.requests).toEqual([]);
  });

  it("says the same when the model fails, so the owner fills the card", async () => {
    const { ctx } = withLlm({ extract_card: [{ name: 42 }] });
    await expect(handleWebJob(ctx, { kind: "extract_card", businessId: "b1", sources: sources({ about: "Йога" }) })).rejects.toMatchObject({ code: "CARD_UNREADABLE" });
  });
});

describe("generate_creatives job", () => {
  const facts: CardFacts = { ...card, city: "Санкт-Петербург", days: "Пн–Пт", advantages: ["Группы до 8 человек"] };
  const ad = (title: string, text: string) => ({ title, text, approach: "price" as const });

  it("returns checked ads and phrases", async () => {
    const { ctx } = withLlm({
      generate_creatives: [
        {
          search: [ad("Хатха-йога за 900 ₽", "Невский проспект, 100. Группы до 8 человек"), ad("Йога на Невском", "Хатха-йога для начинающих, 900 ₽"), ad("Хатха-йога до 21:00", "Занятия в будни, Невский проспект")],
          network: [],
          keywords: ["хатха йога спб", "йога невский"],
          negativeKeywords: ["инструктор", "обучение на инструктора", "видеоуроки"],
        },
      ],
    });
    const result = await handleWebJob(ctx, { kind: "generate_creatives", businessId: "b1", facts, channels: { search: true, network: false } });
    expect(result).toMatchObject({ keywords: ["хатха йога спб", "йога невский"], negativeKeywords: expect.arrayContaining(["инструктор", "обучение на инструктора", "видеоуроки"]) as unknown });
  });

  it("turns a generation failure into a plain message", async () => {
    const { ctx } = withLlm({ generate_creatives: [{ search: [], network: [], keywords: [], negativeKeywords: [] }] });
    await expect(handleWebJob(ctx, { kind: "generate_creatives", businessId: "b1", facts, channels: { search: true, network: false } })).rejects.toMatchObject({
      code: "CREATIVES_FAILED",
      message: "Не получилось подготовить объявления. Попробуйте ещё раз через минуту",
    });
  });
});
