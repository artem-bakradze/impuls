import { z } from "zod";
import { firstIncompleteStep, OnboardingDraftSchema, STEP_COUNT } from "@/lib/onboarding";
import { findBusiness, saveOnboarding } from "@/lib/server/business";
import { webConfig } from "@/lib/server/config";
import { ApiError, handleApi } from "@/lib/server/errors";
import { apiUserId } from "@/lib/server/session";

const Body = z.object({ step: z.number().int().min(1).max(STEP_COUNT), draft: OnboardingDraftSchema });

/** Saves wizard progress; a step can be saved only when every earlier step is complete. */
export async function PUT(request: Request) {
  return handleApi("onboarding.save", async () => {
    const userId = await apiUserId();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(400, "INVALID_PAYLOAD", "Проверьте заполненные поля");
    }
    const { step, draft } = parsed.data;
    if (step > firstIncompleteStep(draft)) {
      throw new ApiError(400, "STEP_INCOMPLETE", "Заполните предыдущие шаги");
    }
    if (draft.directConnected && webConfig().DIRECT_API_MODE !== "simulator") {
      throw new ApiError(400, "DIRECT_NOT_CONNECTED", "Подключение Яндекс Директа пока недоступно");
    }
    const business = await findBusiness(userId);
    if (business?.launchedOn) {
      throw new ApiError(409, "ALREADY_LAUNCHED", "Реклама уже запущена — изменения делаются в настройках");
    }
    await saveOnboarding(userId, step, draft);
    return { ok: true };
  });
}
