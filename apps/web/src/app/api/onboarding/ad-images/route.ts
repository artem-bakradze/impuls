import { z } from "zod";
import { AD_TITLE_MAX, cardFactsOf, stepProblems } from "@/lib/onboarding";
import { findBusiness, readDraft } from "@/lib/server/business";
import { ApiError, handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { parseBody } from "@/lib/server/request";
import { apiUserId } from "@/lib/server/session";

/** `previousImageId`: null for an ad's first picture, its current one for «Другая картинка» and «Попробовать ещё раз». */
const Body = z.object({
  ads: z.array(z.object({ title: z.string().trim().min(1).max(AD_TITLE_MAX), previousImageId: z.string().max(80).nullable() })).min(1).max(5),
});

/** Pictures of partner-site ads for «Как увидят ваши объявления», drawn by the worker from the saved card. */
export async function POST(request: Request) {
  return handleApi("onboarding.ad_images", async () => {
    const body = await parseBody(request, Body);
    const business = await findBusiness(await apiUserId());
    if (!business) {
      throw new ApiError(404, "NO_BUSINESS", "Сначала расскажите о бизнесе");
    }
    if (business.launchedOn) {
      throw new ApiError(409, "ALREADY_LAUNCHED", "Реклама уже запущена — изменения делаются в настройках");
    }
    const draft = readDraft(business);
    if (stepProblems(2, draft).length > 0) {
      throw new ApiError(400, "STEP_INCOMPLETE", "Заполните карточку бизнеса");
    }
    // Only the confirmed card's facts: the worker keeps the category, services, city and the ad's title for the picture.
    const jobId = await enqueueWebJob({ kind: "draw_ad_images", businessId: business.id, facts: cardFactsOf(draft), ads: body.ads });
    return { jobId };
  });
}
