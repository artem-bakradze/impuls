import { NextResponse } from "next/server";
import { checkHealth, systemClock } from "@impuls/worker";
import { logger } from "@/lib/server/logger";
import { store } from "@/lib/server/runtime";

export const dynamic = "force-dynamic";

/**
 * Polled by the external monitor (design decision 13): 503 when budget guard, reconciliation or the
 * dispatcher has not completed for 2 hours, or when the database cannot be read.
 */
export async function GET() {
  try {
    const report = await checkHealth(store(), systemClock);
    if (report.ok) {
      return NextResponse.json({ ok: true });
    }
    logger.warn("Health check failed", { stale: report.stale });
    return NextResponse.json({ code: "HEARTBEAT_STALE", message: "Фоновые задачи давно не выполнялись", stale: report.stale }, { status: 503 });
  } catch (error) {
    logger.error("Health check errored", { error });
    return NextResponse.json({ code: "HEALTH_CHECK_FAILED", message: "Не удалось проверить состояние сервиса" }, { status: 503 });
  }
}
