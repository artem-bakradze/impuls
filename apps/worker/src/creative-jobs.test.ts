import { drawTemplate, firstImageSeed, IdlePolicy, LlmCreativeEngine, LlmError, ScriptedLlmClient } from "@impuls/agent";
import type { CardFacts, ImageEngine, ImageFacts } from "@impuls/agent";
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

describe("draw_ad_images job (ad-creatives «Картинки объявлений на сайтах-партнёрах»)", () => {
  const facts: CardFacts = { ...card, city: "Санкт-Петербург", days: "Пн–Пт", advantages: ["Группы до 8 человек"] };
  const business = {
    id: "b1",
    userId: "u1",
    timeZone: "Europe/Moscow",
    monthlyBudgetRub: 15_000,
    launchedOn: null,
    csoSource: { kind: "user" as const, goal: 30_000 },
    miniSite: null,
    leadGoalId: null,
    mode: "direct" as const,
    card: { category: "Студия йоги", services: [], area: "", hours: "", advantages: [], name: "Прана", address: "", city: "Санкт-Петербург", siteUrl: "https://prana.example/" },
  };

  /** A paid engine that answers from a script and records what it was asked and how many ran at once. */
  const paid = (answers: ("ok" | "fail")[]) => {
    const asked: ImageFacts[] = [];
    let running = 0;
    let peak = 0;
    const engine: ImageEngine = {
      paid: true,
      draw: async (input) => {
        asked.push(input);
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        if (answers.shift() === "fail") throw new LlmError("LLM_UNAVAILABLE", "timeout");
        return { png: drawTemplate(input, 99, 16), width: 16, height: 16, source: "generated" };
      },
    };
    return { engine, asked, peak: () => peak };
  };

  const drawn = (result: unknown) => (result as { images: { imageId: string; note: "failed" | "limit" | null }[] }).images;

  it("draws template pictures without a model: the same ad gets the same one, «Другая картинка» another", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-29T09:00:00Z"), seed: 1, agent: new IdlePolicy() });
    await sim.store.saveBusiness(business);
    const first = drawn(await handleWebJob(sim.ctx, { kind: "draw_ad_images", businessId: "b1", facts, ads: [{ title: "Йога на Невском", previousImageId: null }, { title: "Хатха-йога", previousImageId: null }] }));
    expect(first.map((d) => d.note)).toEqual([null, null]);
    const [a, b] = await Promise.all(first.map((d) => sim.store.adImage(d.imageId)));
    expect(a).toMatchObject({ businessId: "b1", source: "template", width: 1024, height: 1024 });
    const again = drawn(await handleWebJob(sim.ctx, { kind: "draw_ad_images", businessId: "b1", facts, ads: [{ title: "Йога на Невском", previousImageId: null }] }));
    expect(Buffer.from((await sim.store.adImage(again[0]?.imageId ?? ""))?.png ?? []).equals(Buffer.from(a?.png ?? []))).toBe(true);
    expect(Buffer.from(b?.png ?? []).equals(Buffer.from(a?.png ?? []))).toBe(false);

    const other = drawn(await handleWebJob(sim.ctx, { kind: "draw_ad_images", businessId: "b1", facts, ads: [{ title: "Йога на Невском", previousImageId: first[0]?.imageId ?? null }] }));
    const next = await sim.store.adImage(other[0]?.imageId ?? "");
    expect(next?.seed).toBe((a?.seed ?? 0) + 1);
    expect(Buffer.from(next?.png ?? []).equals(Buffer.from(a?.png ?? []))).toBe(false);
  });

  it("sends the image model only the category, services, area and the ad's title, three at a time at most", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-29T09:00:00Z"), seed: 1, agent: new IdlePolicy() });
    await sim.store.saveBusiness(business);
    const { engine, asked, peak } = paid(["ok", "ok", "ok", "ok"]);
    const ctx = { ...sim.ctx, images: engine, imageLimit: { monthly: 10 } };
    const ads = ["Йога на Невском", "Хатха-йога", "Йога утром", "Йога вечером"].map((title) => ({ title, previousImageId: null }));
    const result = drawn(await handleWebJob(ctx, { kind: "draw_ad_images", businessId: "b1", facts: { ...facts, name: "Прана Анны Петровой", address: "Невский проспект, 100" }, ads }));
    expect(result.map((d) => d.note)).toEqual([null, null, null, null]);
    expect(asked[0]).toEqual({ category: "Студия йоги", services: ["Хатха-йога"], area: "Санкт-Петербург", adTitle: "Йога на Невском" });
    expect(JSON.stringify(asked)).not.toMatch(/Анны|Невский проспект/);
    expect(peak()).toBe(3);
    expect((await sim.store.adImage(result[0]?.imageId ?? ""))?.source).toBe("generated");
  });

  it("gives a template picture with «Не получилось нарисовать» when the model fails, without retrying", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-29T09:00:00Z"), seed: 1, agent: new IdlePolicy() });
    await sim.store.saveBusiness(business);
    const { engine, asked } = paid(["fail"]);
    const result = drawn(await handleWebJob({ ...sim.ctx, images: engine, imageLimit: { monthly: 10 } }, { kind: "draw_ad_images", businessId: "b1", facts, ads: [{ title: "Йога на Невском", previousImageId: null }] }));
    expect(result[0]?.note).toBe("failed");
    expect(asked).toHaveLength(1);
    expect((await sim.store.adImage(result[0]?.imageId ?? ""))).toMatchObject({ source: "template", width: 1024 });
  });

  it("draws a template with «Лимит картинок…» once the month's paid pictures are spent", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-29T09:00:00Z"), seed: 1, agent: new IdlePolicy() });
    await sim.store.saveBusiness(business);
    const old = { businessId: "b1", png: Uint8Array.of(1), width: 16, height: 16, source: "generated" as const, seed: 1 };
    await sim.store.saveAdImage({ ...old, id: "img-september", createdAt: new Date("2026-09-30T10:00:00Z") });
    await sim.store.saveAdImage({ ...old, id: "img-october", createdAt: new Date("2026-10-02T10:00:00Z") });
    const { engine, asked } = paid(["ok", "ok"]);
    const result = drawn(await handleWebJob({ ...sim.ctx, images: engine, imageLimit: { monthly: 2 } }, { kind: "draw_ad_images", businessId: "b1", facts, ads: [{ title: "Йога на Невском", previousImageId: null }, { title: "Хатха-йога", previousImageId: null }] }));
    // September's picture is another month; October's counts, so one paid picture is left.
    expect(result.map((d) => d.note)).toEqual([null, "limit"]);
    expect(asked).toHaveLength(1);
    expect((await sim.store.adImage(result[1]?.imageId ?? ""))?.source).toBe("template");
  });

  it("treats another business's picture as none for «Другая картинка»", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-29T09:00:00Z"), seed: 1, agent: new IdlePolicy() });
    await sim.store.saveBusiness(business);
    await sim.store.saveAdImage({ id: "img-foreign", businessId: "b9", png: Uint8Array.of(1), width: 16, height: 16, source: "template", seed: 500, createdAt: new Date("2026-10-02T10:00:00Z") });
    const result = drawn(await handleWebJob(sim.ctx, { kind: "draw_ad_images", businessId: "b1", facts, ads: [{ title: "Йога на Невском", previousImageId: "img-foreign" }] }));
    expect((await sim.store.adImage(result[0]?.imageId ?? ""))?.seed).toBe(firstImageSeed("Йога на Невском"));
  });
});
