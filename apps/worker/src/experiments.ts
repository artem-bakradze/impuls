import { CreativesError, LlmError, WEEK_DAYS } from "@impuls/agent";
import type { CardFacts } from "@impuls/agent";
import type { Command } from "@impuls/core";
import type { JobContext } from "./context";
import type { BusinessRecord } from "./store";

const SCHEDULE = /^(?:(Пн–Вс|Пн–Пт|Пн–Сб|Вт–Вс) )?(\d{2}:00)–(\d{2}:00)$/u;

/**
 * Card facts for a new ad variant from the stored card. The schedule is the display one («Пн–Пт 10:00–20:00»);
 * without days it means every day, as in `buildTimeTargeting`.
 */
export const cardFactsOf = (business: BusinessRecord): CardFacts => {
  const card = business.card;
  const schedule = SCHEDULE.exec(card.hours);
  if (!schedule) {
    throw new Error(`Business ${business.id} has an unreadable schedule: ${card.hours}`);
  }
  const days = (schedule[1] ?? WEEK_DAYS[0]) as CardFacts["days"];
  return {
    name: card.name,
    category: card.category,
    services: card.services,
    address: card.address,
    city: card.city,
    days,
    openFrom: schedule[2] ?? "",
    openTo: schedule[3] ?? "",
    advantages: card.advantages,
  };
};

export type PreparedCommand = { ok: true; command: Command } | { ok: false; code: string; message: string };

/**
 * Fills the single-change ad variant and its hypothesis for `StartExperiment` from ad-creatives, outside the
 * business lock: generation can take a while and must not hold up other commands. Other commands pass unchanged.
 */
export const prepareExperiment = async (ctx: JobContext, businessId: string, command: Command): Promise<PreparedCommand> => {
  if (command.type !== "StartExperiment" || command.variant !== undefined) {
    return { ok: true, command };
  }
  const ad = (await ctx.store.ads(businessId)).find((a) => a.id === command.adId && a.directionId === command.directionId);
  if (!ad) {
    return { ok: false, code: "OBJECT_NOT_FOUND", message: "объект не найден" };
  }
  try {
    const variant = await ctx.creatives.variant(cardFactsOf(await ctx.store.getBusiness(businessId)), { title: ad.title, text: ad.text }, command.kind);
    return { ok: true, command: { ...command, hypothesis: variant.hypothesis, variant: { title: variant.title, text: variant.text } } };
  } catch (error) {
    if (error instanceof CreativesError || error instanceof LlmError) {
      return { ok: false, code: "VARIANT_FAILED", message: "не получилось подготовить вариант объявления" };
    }
    throw error;
  }
};
