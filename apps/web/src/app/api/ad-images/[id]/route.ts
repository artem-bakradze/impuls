import { eq, schema } from "@impuls/db";
import { findBusiness } from "@/lib/server/business";
import { ApiError, errorResponse } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";
import { db } from "@/lib/server/runtime";
import { apiUserId } from "@/lib/server/session";

/** An id never gets another picture, so the browser may keep it; it stays private to the owner's session. */
const CACHE = "private, max-age=31536000, immutable";

/**
 * The picture of a partner-site ad (network-ad-images decision 2): only the business's own owner gets it; another
 * business's picture looks the same as a missing one.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const business = await findBusiness(await apiUserId());
    const { id } = await params;
    const [row] = business === null ? [] : await db().select({ businessId: schema.adImages.businessId, png: schema.adImages.png }).from(schema.adImages).where(eq(schema.adImages.id, id));
    if (row === undefined || row.businessId !== business?.id) {
      throw new ApiError(404, "IMAGE_NOT_FOUND", "Картинка не найдена");
    }
    return new Response(Buffer.from(row.png), { headers: { "Content-Type": "image/png", "Cache-Control": CACHE, "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (error instanceof ApiError) {
      logger.warn("API request rejected", { route: "ad_images.get", errorCode: error.code });
      return errorResponse(error.status, error.code, error.message);
    }
    logger.error("API request failed", { route: "ad_images.get", error });
    return errorResponse(500, "INTERNAL_ERROR", "Что-то пошло не так. Попробуйте ещё раз через минуту");
  }
}
