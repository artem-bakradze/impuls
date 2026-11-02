import { z } from "zod";
import { ApiError, handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { parseBody } from "@/lib/server/request";
import { buildSimulationStatus } from "@/lib/server/simulation";
import { apiLaunchedBusiness } from "@/lib/server/session";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["pause", "resume", "until_decision", "step_day", "extend", "restart", "go_real"]) }),
  z.object({ action: z.literal("speed"), speed: z.enum(["fast", "minute", "real"]) }),
]);

const simulatedBusiness = async () => {
  const business = await apiLaunchedBusiness();
  if (business.mode !== "simulation") {
    throw new ApiError(409, "NOT_SIMULATED", "Реклама работает в Яндекс Директе, а не в симуляции");
  }
  return business;
};

/** The pult polls this once a second. */
export async function GET() {
  return handleApi("simulation.status", async () => {
    const business = await simulatedBusiness();
    return buildSimulationStatus(business.id);
  });
}

/** Pult actions are executed by the worker like any other change (add-simulation-mode decision 7). */
export async function POST(request: Request) {
  return handleApi("simulation.control", async () => {
    const business = await simulatedBusiness();
    const control = await parseBody(request, Body);
    const jobId = await enqueueWebJob({ kind: "simulation_control", businessId: business.id, control });
    return { jobId };
  });
}
