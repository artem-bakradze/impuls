import "server-only";
import { NextResponse } from "next/server";
import { logger } from "./logger";

/** API error with a stable code and a plain Russian message (design decision 13). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ErrorBody {
  code: string;
  message: string;
}

export const errorResponse = (status: number, code: string, message: string): NextResponse<ErrorBody> =>
  NextResponse.json({ code, message }, { status });

/** Boundary handler for API routes: known errors become `{ code, message }`, the rest is logged and hidden. */
export const handleApi = async <T>(route: string, run: () => Promise<T>): Promise<NextResponse> => {
  try {
    const body = await run();
    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof ApiError) {
      logger.warn("API request rejected", { route, errorCode: error.code });
      return errorResponse(error.status, error.code, error.message);
    }
    logger.error("API request failed", { route, error });
    return errorResponse(500, "INTERNAL_ERROR", "Что-то пошло не так. Попробуйте ещё раз через минуту");
  }
};
