import { ApiError, handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { parseBody } from "@/lib/server/request";
import { buildSimulationStatus } from "@/lib/server/simulation";
import { isCurrentAction, SimulationControlBody } from "@/lib/simulation-model";
import { apiLaunchedBusiness } from "@/lib/server/session";


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
    const control = await parseBody(request, SimulationControlBody);
    // The pult of an old page: the time no longer runs by itself (simulation-mode «Виртуальное время и пульт»).
    if (!isCurrentAction(control)) {
      throw new ApiError(410, "SIMULATION_ACTION_GONE", "Пульт симуляции обновился — обновите страницу");
    }
    const jobId = await enqueueWebJob({ kind: "simulation_control", businessId: business.id, control });
    return { jobId };
  });
}
