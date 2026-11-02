import { toLocalDate } from "@impuls/core";
import { SCENARIO_IDS, SCENARIOS, scenarioStartDate } from "@impuls/worker/scenarios";
import { z } from "zod";
import { buildLaunchPlan, firstIncompleteStep, hasOwnSite, STEP_COUNT } from "@/lib/onboarding";
import { findBusiness, readDraft } from "@/lib/server/business";
import { ApiError, handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { platformCapabilities } from "@/lib/server/read-context";
import { parseBody } from "@/lib/server/request";
import { apiUserId } from "@/lib/server/session";

/** `simulation`: «Запустить в симуляции» with a market scenario instead of Direct (simulation-mode spec). */
const Body = z.object({ simulation: z.object({ scenario: z.enum(SCENARIO_IDS) }).optional() });

/** «Запустить»: the worker creates the campaigns (launch job); web only enqueues the plan. */
export async function POST(request: Request) {
  return handleApi("onboarding.launch", async () => {
    const body = await parseBody(request, Body);
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
    // Every ad must lead to a landing page (platform-integration spec); the mini-site can only be made after launch yet.
    if (!hasOwnSite(draft)) {
      throw new ApiError(400, "NO_LANDING_PAGE", "Укажите адрес вашего сайта на первом шаге — реклама должна вести на страницу о вас");
    }
    const today = toLocalDate(new Date(), business.timeZone);
    // A simulation starts on its own virtual date (the 1st of the next month), so its limits are for that month.
    const launchDay = body.simulation ? scenarioStartDate(SCENARIOS[body.simulation.scenario], today) : today;
    const plan = buildLaunchPlan(draft, launchDay, platformCapabilities(body.simulation ? "simulation" : "direct").minWeeklyLimit / 100);
    if (plan.directions.length === 0) {
      throw new ApiError(400, "EMPTY_PLAN", "Оставьте хотя бы одно объявление");
    }
    const jobId = await enqueueWebJob({ kind: "launch", businessId: business.id, plan, ...(body.simulation && { simulation: body.simulation }) });
    return { jobId };
  });
}
