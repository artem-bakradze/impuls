import { cardFactsOf, stepProblems } from "@/lib/onboarding";
import { findBusiness, readDraft } from "@/lib/server/business";
import { ApiError, handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { apiUserId } from "@/lib/server/session";

/** Ads and phrases for «Как увидят ваши объявления», made by the worker from the saved card. */
export async function POST() {
  return handleApi("onboarding.creatives", async () => {
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
    const jobId = await enqueueWebJob({ kind: "generate_creatives", businessId: business.id, facts: cardFactsOf(draft), channels: { search: true, network: true } });
    return { jobId };
  });
}
