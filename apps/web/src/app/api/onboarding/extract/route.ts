import { findBusiness, readDraft } from "@/lib/server/business";
import { ApiError, handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { apiUserId } from "@/lib/server/session";

/** «Где вас найти?» → the worker reads the saved links and description and extracts the card. */
export async function POST() {
  return handleApi("onboarding.extract", async () => {
    const business = await findBusiness(await apiUserId());
    if (!business) {
      throw new ApiError(404, "NO_BUSINESS", "Сначала расскажите о бизнесе");
    }
    if (business.launchedOn) {
      throw new ApiError(409, "ALREADY_LAUNCHED", "Реклама уже запущена — изменения делаются в настройках");
    }
    const { sources } = readDraft(business);
    const jobId = await enqueueWebJob({ kind: "extract_card", businessId: business.id, sources });
    return { jobId };
  });
}
