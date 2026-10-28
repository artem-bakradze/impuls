import { findBusiness } from "@/lib/server/business";
import { ApiError, handleApi } from "@/lib/server/errors";
import { readWebJob } from "@/lib/server/jobs";
import { apiUserId } from "@/lib/server/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi("jobs.get", async () => {
    const business = await findBusiness(await apiUserId());
    if (!business) {
      throw new ApiError(404, "JOB_NOT_FOUND", "Действие не найдено");
    }
    const { id } = await params;
    return readWebJob(business.id, id);
  });
}
