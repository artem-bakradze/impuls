import { z } from "zod";
import { handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { parseBody } from "@/lib/server/request";
import { apiLaunchedBusiness } from "@/lib/server/session";

const Body = z.object({ entryId: z.string().min(1), includeLater: z.boolean().optional(), confirmDifference: z.boolean().optional() });

/** «Вернуть как было»: rollback is a command in the worker; chain and cabinet differences come back as results. */
export async function POST(request: Request) {
  return handleApi("history.rollback", async () => {
    const business = await apiLaunchedBusiness();
    const body = await parseBody(request, Body);
    return {
      jobId: await enqueueWebJob({
        kind: "rollback",
        businessId: business.id,
        entryId: body.entryId,
        ...(body.includeLater !== undefined ? { includeLater: body.includeLater } : {}),
        ...(body.confirmDifference !== undefined ? { confirmDifference: body.confirmDifference } : {}),
      }),
    };
  });
}
