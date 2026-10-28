import { toLocalDate } from "@impuls/core";
import { buildLaunchPlan, firstIncompleteStep, STEP_COUNT } from "@/lib/onboarding";
import { findBusiness, readDraft } from "@/lib/server/business";
import { ApiError, handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { platformCapabilities } from "@/lib/server/read-context";
import { apiUserId } from "@/lib/server/session";

/** «Запустить»: the worker creates the campaigns (launch job); web only enqueues the plan. */
export async function POST() {
  return handleApi("onboarding.launch", async () => {
    const business = await findBusiness(await apiUserId());
    if (!business) {
      throw new ApiError(404, "NO_BUSINESS", "Сначала расскажите о бизнесе");
    }
    if (business.launchedOn) {
      throw new ApiError(409, "ALREADY_LAUNCHED", "Реклама уже запущена");
    }
    const draft = readDraft(business);
    if (firstIncompleteStep(draft) < STEP_COUNT || business.onboardingStep < STEP_COUNT) {
      throw new ApiError(400, "STEP_INCOMPLETE", "Заполните все шаги перед запуском");
    }
    const today = toLocalDate(new Date(), business.timeZone);
    const plan = buildLaunchPlan(draft, today, platformCapabilities().minWeeklyLimit / 100);
    if (plan.directions.length === 0) {
      throw new ApiError(400, "EMPTY_PLAN", "Оставьте хотя бы одно объявление");
    }
    const jobId = await enqueueWebJob({ kind: "launch", businessId: business.id, plan });
    return { jobId };
  });
}
