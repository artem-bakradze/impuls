import { findBusiness, readDraft } from "@/lib/server/business";
import { ApiError, handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { apiUserId } from "@/lib/server/session";

/** «Что для вас клиент?» → the worker reads the saved site and looks for the Metrica counter code. */
export async function POST() {
  return handleApi("onboarding.counter", async () => {
    const business = await findBusiness(await apiUserId());
    if (!business) {
      throw new ApiError(404, "NO_BUSINESS", "Сначала расскажите о бизнесе");
    }
    const { sources } = readDraft(business);
    if (sources.siteUrl === "") {
      throw new ApiError(400, "NO_SITE", "Сначала укажите адрес сайта");
    }
    const jobId = await enqueueWebJob({ kind: "check_counter", businessId: business.id, siteUrl: sources.siteUrl });
    return { jobId };
  });
}
