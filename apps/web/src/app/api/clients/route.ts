import { z } from "zod";
import { handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { parseBody } from "@/lib/server/request";
import { apiLaunchedBusiness } from "@/lib/server/session";

const Body = z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), clients: z.number().int().min(0) });

/** Weekly answer «сколько обращений стали клиентами»; the worker checks the range against the week's leads. */
export async function POST(request: Request) {
  return handleApi("clients.confirm", async () => {
    const business = await apiLaunchedBusiness();
    const body = await parseBody(request, Body);
    return { jobId: await enqueueWebJob({ kind: "clients", businessId: business.id, week: body.week, clients: body.clients }) };
  });
}
