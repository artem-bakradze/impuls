import { z } from "zod";
import { MIN_BUDGET_RUB } from "@/lib/onboarding";
import { handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { parseBody } from "@/lib/server/request";
import { apiLaunchedBusiness } from "@/lib/server/session";

const Body = z.object({ monthlyBudgetRub: z.number().int().min(MIN_BUDGET_RUB), confirmed: z.boolean() });

/**
 * New monthly budget. Without confirmation the worker only previews it and does not apply it when the new ceiling
 * is already spent («реклама будет остановлена до 1-го числа»); the owner then confirms explicitly.
 */
export async function POST(request: Request) {
  return handleApi("budget.change", async () => {
    const business = await apiLaunchedBusiness();
    const body = await parseBody(request, Body);
    return { jobId: await enqueueWebJob({ kind: "budget", businessId: business.id, monthlyBudgetRub: body.monthlyBudgetRub, confirmed: body.confirmed }) };
  });
}
