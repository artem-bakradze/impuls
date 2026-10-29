/**
 * Live check of the LLM creative engine (tasks 6.1–6.3): card extraction from fixture pages, generation for the
 * extracted card and one hypothesis variant. Paid (cents); run on request only.
 *
 *   set -a; . ./.env.local; set +a
 *   OPENAI_TEXT_MODEL=gpt-6.1-terra pnpm --filter @impuls/agent exec tsx spikes/creatives-live.ts [fixture.html]
 */
import { readFileSync } from "node:fs";
import { checkAd, htmlToText, LlmCreativeEngine } from "../src/creatives";
import type { CardFacts } from "../src/creatives";
import { OpenAiLlmClient } from "../src/llm";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_TEXT_MODEL;
if (!apiKey || !model) {
  throw new Error(`${!apiKey ? "OPENAI_API_KEY" : "OPENAI_TEXT_MODEL"} is required for the live creatives check`);
}
const fixture = process.argv[2] ?? "tilda-nails.html";
const engine = new LlmCreativeEngine(new OpenAiLlmClient({ apiKey, model }));

const started = Date.now();
const card = await engine.extractCard([{ source: "site", text: htmlToText(readFileSync(new URL(`../fixtures/pages/${fixture}`, import.meta.url), "utf8")) }]);
console.log("card", JSON.stringify(card, null, 2), `${Date.now() - started} ms`);

const facts: CardFacts = {
  name: card.name ?? "",
  category: card.category ?? "",
  services: card.services,
  address: card.address ?? "",
  city: (card.address ?? "").split(",")[0]?.trim() ?? "",
  days: card.days ?? "Пн–Вс",
  openFrom: card.openFrom ?? "10:00",
  openTo: card.openTo ?? "20:00",
  advantages: card.advantages,
};
const t1 = Date.now();
const creatives = await engine.generate(facts, { search: true, network: true });
console.log("creatives", JSON.stringify(creatives, null, 2), `${Date.now() - t1} ms`);
console.log("all ads pass checks:", [...creatives.search, ...creatives.network].every((ad) => checkAd(ad, facts).length === 0));

const first = creatives.search[0];
if (first) {
  const t2 = Date.now();
  console.log("variant", JSON.stringify(await engine.variant(facts, first, "offer"), null, 2), `${Date.now() - t2} ms`);
}
