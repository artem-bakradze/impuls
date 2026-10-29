import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkAd, cleanPhrases, CreativesError, htmlToText, inventedFacts, LlmCreativeEngine, TemplateCreativeEngine } from "./creatives";
import type { CardFacts } from "./creatives";
import { ScriptedLlmClient } from "./llm";

const page = (name: string): string => readFileSync(new URL(`../fixtures/pages/${name}`, import.meta.url), "utf8");

const salon: CardFacts = {
  name: "Ноготок",
  category: "Маникюрный салон",
  services: [
    { name: "Маникюр с покрытием", priceRub: 1_800 },
    { name: "Педикюр", priceRub: null },
  ],
  address: "Москва, м. Профсоюзная, 1",
  city: "Москва",
  days: "Пн–Вс",
  openFrom: "10:00",
  openTo: "22:00",
  advantages: ["Стерилизация в сухожаре"],
};

const good = [
  { title: "Маникюр с покрытием за 1 800 ₽", text: "Студия у м. Профсоюзная. Запись онлайн, работаем до 22:00", approach: "price" },
  { title: "Маникюр у м. Профсоюзная", text: "Работаем до 22:00 без выходных. Запишитесь онлайн", approach: "convenience" },
  { title: "Педикюр и маникюр рядом с домом", text: "Стерилизация в сухожаре. Аккуратно и спокойно", approach: "result" },
];

describe("htmlToText", () => {
  it("keeps visible text and drops scripts, styles, svg and comments", () => {
    const text = htmlToText(page("tilda-nails.html"));
    expect(text).toContain("Студия маникюра «Ноготок»");
    expect(text).toContain("Маникюр с покрытием — 1 800 ₽");
    expect(text).toContain("Снятие покрытия — 300 ₽");
    expect(text).not.toMatch(/tildaForm|font-family|footer/);
  });

  it.each([
    ["yoga-wix.html", ["Студия йоги «Прана»", "Хатха-йога для начинающих – 900 ₽", "Пн–Пт 08:00–21:00"], /wix-warmup|payload|path/],
    ["yandex-maps-org.html", ["Барбершоп «Бритва»", "Казань, ул. Баумана, 15", "Мужская стрижка 1 200 ₽"], /INITIAL_STATE/],
    ["vk-group.html", ["Массаж у Ольги", "Классический массаж спины — 1500 ₽", "Ежедневно 09:00–20:00"], /<div/],
  ])("extracts the business facts from %s", (file, expected, absent) => {
    const text = htmlToText(page(file));
    for (const fact of expected) {
      expect(text).toContain(fact);
    }
    expect(text).not.toMatch(absent);
  });

  it("caps very long pages", () => {
    expect(htmlToText(`<p>${"а".repeat(50_000)}</p>`)).toHaveLength(20_000);
  });
});

describe("fact checks", () => {
  it("accepts an ad built on card facts", () => {
    expect(checkAd({ title: "Маникюр с покрытием за 1 800 ₽", text: "У м. Профсоюзная, работаем до 22:00" }, salon)).toEqual([]);
  });

  it("flags a price or time the card does not have", () => {
    expect(inventedFacts({ title: "Маникюр за 1 500 ₽", text: "Работаем до 23:00" }, salon).map((i) => i.message)).toEqual([
      "цены 1500 ₽ нет в карточке бизнеса",
      "времени 23:00 нет в часах работы",
    ]);
  });

  it("flags a superlative and an ad without any card fact", () => {
    expect(checkAd({ title: "Лучший маникюр в районе", text: "Приходите к нам" }, salon).map((i) => i.code)).toEqual(["SUPERLATIVE", "NO_FACT"]);
  });
});

describe("keywords", () => {
  it("cleans, dedupes and drops phrases longer than 7 words", () => {
    expect(cleanPhrases(["Маникюр!", "маникюр", "ёлочный маникюр", "один два три четыре пять шесть семь восемь"])).toEqual(["маникюр", "елочный маникюр"]);
  });
});

describe("LlmCreativeEngine", () => {
  it("extracts the card and drops advantages with superlatives", async () => {
    const llm = new ScriptedLlmClient({
      extract_card: [
        {
          name: "Ноготок",
          category: "Студия маникюра",
          services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }],
          address: "Москва, ул. Профсоюзная, 1",
          days: "Пн–Вс",
          openFrom: "10:00",
          openTo: "22:00",
          phone: "+7 (495) 123-45-67",
          advantages: ["Лучшие мастера района", "Стерилизация в сухожаре"],
        },
      ],
    });
    const card = await new LlmCreativeEngine(llm).extractCard([{ source: "site", text: htmlToText(page("tilda-nails.html")) }]);
    expect(card.advantages).toEqual(["Стерилизация в сухожаре"]);
    expect(llm.requests[0]?.input).toContain("### site\nНоготок — маникюр у метро Профсоюзная\nСтудия маникюра «Ноготок»");
  });

  it("rewrites «Лучший маникюр в районе» and an invented discount before anything is returned", async () => {
    const llm = new ScriptedLlmClient({
      generate_creatives: [
        {
          search: [...good.slice(0, 2), { title: "Лучший маникюр в районе", text: "Скидка 20% на первый визит, м. Профсоюзная", approach: "newcomers" }],
          network: [],
          keywords: ["Маникюр с покрытием", "маникюр профсоюзная", "маникюр москва"],
          negativeKeywords: ["обучение", "своими руками", "курсы маникюра"],
        },
      ],
      rewrite_ads: [{ ads: [{ title: "Маникюр с покрытием у метро", text: "У м. Профсоюзная, работаем до 22:00" }] }],
    });
    const result = await new LlmCreativeEngine(llm).generate(salon, { search: true, network: false });
    expect(result.search).toHaveLength(3);
    expect(result.search.map((a) => a.title)).not.toContain("Лучший маникюр в районе");
    expect(result.search.every((ad) => checkAd(ad, salon).length === 0)).toBe(true);
    expect(llm.requests.map((r) => r.task)).toEqual(["generate_creatives", "rewrite_ads"]);
    expect(llm.requests[1]?.input).toContain("превосходная степень");
    expect(result.keywords).toEqual(["маникюр с покрытием", "маникюр профсоюзная", "маникюр москва"]);
    expect(result.negativeKeywords).toEqual(["обучение", "курсы", "вакансии", "своими руками", "бесплатно", "курсы маникюра"]);
  });

  it("refuses when fewer than 3 ads pass after rewrites", async () => {
    const badAd = { title: "Лучший маникюр", text: "Приходите" };
    const bad = { ...badAd, approach: "price" };
    const llm = new ScriptedLlmClient({
      generate_creatives: [{ search: [good[0], bad, bad], network: [], keywords: ["маникюр"], negativeKeywords: [] }],
      rewrite_ads: [{ ads: [badAd, badAd] }, { ads: [badAd, badAd] }],
    });
    await expect(new LlmCreativeEngine(llm).generate(salon, { search: true, network: false })).rejects.toMatchObject({ code: "NOT_ENOUGH_ADS" });
  });

  it("returns a variant with exactly one change and a plain hypothesis", async () => {
    const ad = { title: "Маникюр 1 800 ₽ у метро", text: "У м. Профсоюзная, работаем до 22:00" };
    const llm = new ScriptedLlmClient({
      hypothesis_variant: [
        // The model also touched the title; only the text is taken for an offer hypothesis.
        { title: "Другой заголовок", text: "Педикюр и маникюр у м. Профсоюзная", hypothesis: "Проверяем, приведёт ли упоминание педикюра больше записей" },
      ],
    });
    const variant = await new LlmCreativeEngine(llm).variant(salon, ad, "offer");
    expect(variant).toEqual({ title: ad.title, text: "Педикюр и маникюр у м. Профсоюзная", changed: "text", hypothesis: "Проверяем, приведёт ли упоминание педикюра больше записей" });
  });

  it("rejects a variant that changes nothing", async () => {
    const ad = { title: "Маникюр у м. Профсоюзная", text: "Работаем до 22:00" };
    const same = { title: ad.title, text: ad.text, hypothesis: "Проверяем то же самое" };
    const llm = new ScriptedLlmClient({ hypothesis_variant: [same, same, same] });
    await expect(new LlmCreativeEngine(llm).variant(salon, ad, "benefit")).rejects.toBeInstanceOf(CreativesError);
  });
});

describe("TemplateCreativeEngine", () => {
  it("builds honest drafts and phrases from the card without an LLM", async () => {
    const result = await new TemplateCreativeEngine().generate(salon, { search: true, network: true });
    expect(result.search[0]?.title.replace(/ /g, " ")).toBe("Маникюр с покрытием от 1 800 ₽");
    expect(result.network).toHaveLength(1);
    expect(result.keywords).toEqual(["маникюр с покрытием", "маникюр с покрытием москва", "педикюр", "педикюр москва"]);
    expect(result.negativeKeywords).toEqual(["обучение", "курсы", "вакансии", "своими руками", "бесплатно"]);
  });

  it("finds nothing on its own: the owner fills the card", async () => {
    expect(await new TemplateCreativeEngine().extractCard()).toMatchObject({ name: null, services: [], advantages: [] });
  });
});
