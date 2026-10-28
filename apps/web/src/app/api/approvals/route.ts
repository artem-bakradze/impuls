import { z } from "zod";
import { handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { parseBody } from "@/lib/server/request";
import { apiLaunchedBusiness } from "@/lib/server/session";

const Body = z.object({ approvalId: z.string().min(1), approve: z.boolean() });

/** «Спрашивать перед крупными изменениями»: the owner's answer; the worker looks the request up within the business. */
export async function POST(request: Request) {
  return handleApi("approvals.decide", async () => {
    const business = await apiLaunchedBusiness();
    const body = await parseBody(request, Body);
    return { jobId: await enqueueWebJob({ kind: "approval", businessId: business.id, approvalId: body.approvalId, approve: body.approve }) };
  });
}
