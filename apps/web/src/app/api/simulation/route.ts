import { checkPeriod } from "@impuls/worker/simulation-period";
import { ApiError, handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { parseBody } from "@/lib/server/request";
import { buildSimulationStatus } from "@/lib/server/simulation";
import { currentAction, SimulationControlBody } from "@/lib/simulation-model";
import { apiLaunchedBusiness } from "@/lib/server/session";

const simulatedBusiness = async () => {
  const business = await apiLaunchedBusiness();
  if (business.mode !== "simulation") {
    throw new ApiError(409, "NOT_SIMULATED", "Реклама работает в Яндекс Директе, а не в симуляции");
  }
  return business;
};

/** The player polls this once a second. */
export async function GET() {
  return handleApi("simulation.status", async () => {
    const business = await simulatedBusiness();
    return buildSimulationStatus(business.id);
  });
}

/**
 * Player actions are executed by the worker like any other change (add-simulation-mode decision 7). A period is checked
 * here first against the advertising as it is now, with the window's own rules; the worker checks it once more.
 */
export async function POST(request: Request) {
  return handleApi("simulation.control", async () => {
    const business = await simulatedBusiness();
    const control = currentAction(await parseBody(request, SimulationControlBody));
    // The player of an old page: days and weeks are now periods of the owner's numbers.
    if (control === null) {
      throw new ApiError(410, "SIMULATION_ACTION_GONE", "Пульт симуляции обновился — обновите страницу");
    }
    if (control.action === "period") {
      const status = await buildSimulationStatus(business.id);
      if (status === null) throw new ApiError(409, "NOT_SIMULATED", "Реклама работает в Яндекс Директе, а не в симуляции");
      const check = checkPeriod(status.form, control.days, control.ads);
      const [first] = check.errors;
      if (check.changed || first !== undefined) {
        throw new ApiError(check.changed ? 409 : 422, check.changed ? "SIMULATION_ADS_CHANGED" : "SIMULATION_PERIOD_INVALID", first?.message ?? "Проверьте цифры");
      }
    }
    const jobId = await enqueueWebJob({ kind: "simulation_control", businessId: business.id, control });
    return { jobId };
  });
}
