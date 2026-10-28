import { z } from "zod";
import { setAutonomy } from "@/lib/server/business";
import { handleApi } from "@/lib/server/errors";
import { parseBody } from "@/lib/server/request";
import { apiLaunchedBusiness } from "@/lib/server/session";

const Body = z.object({ autonomy: z.enum(["auto", "ask"]) });

/** Autonomy is a preference the worker reads before each agent action; it does not touch the ad platform. */
export async function PUT(request: Request) {
  return handleApi("settings.autonomy", async () => {
    const business = await apiLaunchedBusiness();
    const { autonomy } = await parseBody(request, Body);
    await setAutonomy(business.id, autonomy);
    return { ok: true, autonomy };
  });
}
