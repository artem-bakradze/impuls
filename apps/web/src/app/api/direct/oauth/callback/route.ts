import { NextResponse } from "next/server";
import { finishAuthorization } from "@/lib/direct-oauth";
import type { DirectOAuthOutcome } from "@/lib/direct-oauth";
import { directOAuthDeps } from "@/lib/server/direct-account";
import { logger } from "@/lib/server/logger";
import { currentUserId } from "@/lib/server/session";

/** Yandex redirects here after the consent screen; the outcome is shown on the «Подключение Директа» step. */
export async function GET(request: Request) {
  const userId = await currentUserId();
  if (userId === null) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  let outcome: DirectOAuthOutcome;
  try {
    outcome = await finishAuthorization(directOAuthDeps(), new URL(request.url).searchParams, userId);
  } catch (error) {
    logger.error("Direct OAuth callback failed", { userId, error });
    outcome = "failed";
  }
  logger.info("Direct OAuth finished", { userId, outcome });
  return NextResponse.redirect(new URL(`/wizard?direct=${outcome}`, request.url));
}
