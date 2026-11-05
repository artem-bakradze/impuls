import { randomUUID } from "node:crypto";
import { firstImageSeed, imageFactsOf, LlmError, TemplateImageEngine } from "@impuls/agent";
import type { AdImage, CardFacts, ImageFacts } from "@impuls/agent";
import { monthKey, toLocalDate } from "@impuls/core";
import type { JobContext } from "./context";

/**
 * Pictures of the ads on partner sites in the wizard (network-ad-images decision 3). A failed or over-limit paid
 * picture becomes a template one with a note — the degraded mode the ad-creatives spec defines; there is no silent
 * retry, «Попробовать ещё раз» is the owner's.
 */

/** `failed`: «Не получилось нарисовать картинку — показываем простую»; `limit`: «Лимит картинок на этот месяц исчерпан…». */
export type ImageNote = "failed" | "limit";

export interface DrawnImage {
  imageId: string;
  note: ImageNote | null;
}

/** The result of the `draw_ad_images` job, one picture per asked ad in its order. */
export interface DrawnImages {
  images: DrawnImage[];
}

/** Drawn together at most, so a wizard with many ads does not flood the image model. */
const PARALLEL = 3;
/** Enough to hold a whole calendar month in any time zone; the month itself is picked by its key. */
const MONTH_WINDOW_MS = 32 * 86_400_000;

const TEMPLATE = new TemplateImageEngine();

/** How many paid pictures the business may still draw this calendar month in its time zone. */
const paidPicturesLeft = async (ctx: JobContext, businessId: string): Promise<number> => {
  if (ctx.imageLimit === undefined) {
    throw new Error("A paid image engine needs the monthly picture limit (IMAGE_MONTHLY_LIMIT)");
  }
  const business = await ctx.store.getBusiness(businessId);
  const now = ctx.clock.now();
  const month = monthKey(toLocalDate(now, business.timeZone));
  const drawn = await ctx.store.generatedImageTimes(businessId, new Date(now.getTime() - MONTH_WINDOW_MS));
  return Math.max(0, ctx.imageLimit.monthly - drawn.filter((at) => monthKey(toLocalDate(at, business.timeZone)) === month).length);
};

const drawOne = async (ctx: JobContext, businessId: string, facts: ImageFacts, seed: number, paidAllowed: boolean): Promise<DrawnImage> => {
  let image: AdImage;
  let note: ImageNote | null = null;
  if (!ctx.images.paid) {
    image = await ctx.images.draw(facts, seed);
  } else if (!paidAllowed) {
    image = await TEMPLATE.draw(facts, seed);
    note = "limit";
  } else {
    try {
      image = await ctx.images.draw(facts, seed);
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      image = await TEMPLATE.draw(facts, seed);
      note = "failed";
    }
  }
  const imageId = `img-${randomUUID()}`;
  await ctx.store.saveAdImage({ id: imageId, businessId, png: image.png, width: image.width, height: image.height, source: image.source, seed, createdAt: ctx.clock.now() });
  return { imageId, note };
};

/** Draws one picture per item, in order, no more than three at a time and within the month's paid limit. */
export const drawAdImages = async (ctx: JobContext, businessId: string, items: readonly { facts: ImageFacts; seed: number }[]): Promise<DrawnImage[]> => {
  let left = ctx.images.paid && items.length > 0 ? await paidPicturesLeft(ctx, businessId) : 0;
  const drawn: DrawnImage[] = [];
  for (let start = 0; start < items.length; start += PARALLEL) {
    const batch = items.slice(start, start + PARALLEL).map((item) => {
      const paidAllowed = left > 0;
      if (paidAllowed) left -= 1;
      return drawOne(ctx, businessId, item.facts, item.seed, paidAllowed);
    });
    drawn.push(...(await Promise.all(batch)));
  }
  return drawn;
};

/**
 * The wizard's pictures: an ad's first one has the seed of its title, so the same ad gets the same template;
 * «Другая картинка» takes the next seed after its current picture. Only the card's public facts and the ad's own title
 * reach the picture (ad-creatives spec «Только публичные данные»); a picture of another business counts as none.
 */
export const drawWizardImages = async (
  ctx: JobContext,
  businessId: string,
  card: CardFacts,
  ads: readonly { title: string; previousImageId: string | null }[],
): Promise<DrawnImage[]> => {
  const items: { facts: ImageFacts; seed: number }[] = [];
  for (const ad of ads) {
    const previous = ad.previousImageId === null ? null : await ctx.store.adImage(ad.previousImageId);
    const seed = previous !== null && previous.businessId === businessId ? previous.seed + 1 : firstImageSeed(ad.title);
    items.push({ facts: imageFactsOf(card, ad.title), seed });
  }
  return drawAdImages(ctx, businessId, items);
};
