import { NextResponse } from "next/server";
import { startAuthorization } from "@/lib/direct-oauth";
import { findBusiness } from "@/lib/server/business";
import { directOAuthConfig, directOAuthDeps } from "@/lib/server/direct-account";
import { logger } from "@/lib/server/logger";
import { currentUserId } from "@/lib/server/session";

/** «Подключить Яндекс Директ»: redirects to the Yandex consent screen with a one-time state. */
export async function GET(request: Request) {
  const userId = await currentUserId();
  if (userId === null) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (!(await findBusiness(userId))) {
    return NextResponse.redirect(new URL("/wizard", request.url));
  }
  const url = await startAuthorization(directOAuthDeps(), directOAuthConfig(), userId);
  logger.info("Direct OAuth started", { userId });
  return NextResponse.redirect(url);
}
