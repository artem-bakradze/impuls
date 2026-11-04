"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { callApi, runWebJob } from "@/lib/client-api";
import type { SimulationAction, SimulationStatus } from "@/lib/simulation-model";

/**
 * The studio's clock: polls the virtual day, refreshes the server page only when a step is over, and sends the
 * owner's steps. It never walks the time by itself: every day is a deliberate press.
 */
export const useSimulation = (initial: SimulationStatus) => {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turnSeenAt, setTurnSeenAt] = useState<number | null>(initial.agentTurn ? Date.now() : null);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef({ changes: initial.changes, day: initial.day, status: initial.status, thinking: initial.agentTurn !== null, weeks: initial.weeks });
  /**
   * A step the owner pressed that the worker has not taken yet: until then the server still says «paused» about the day
   * before, and that must not put «прожит» back on the screen (simulation-mode spec: a step that is not over is not shown
   * as lived). Cleared when the server shows the step moving or failing, or when its job ends.
   */
  const pressed = useRef<{ day: number; weeks: number } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void callApi<SimulationStatus>("/api/simulation", "GET").then((result) => {
        if (result.kind !== "ok") return;
        const next = result.body;
        const waiting = pressed.current;
        if (waiting !== null) {
          const moved = next.status === "stepping" || next.failed === true || next.day !== waiting.day || next.weeks !== waiting.weeks;
          if (!moved) return;
          pressed.current = null;
        }
        const before = seen.current;
        // The page's numbers wait for the end of a step; during a step only the clock and the day strip move.
        if (next.status === "paused" && (before.status === "stepping" || next.changes !== before.changes)) {
          router.refresh();
        }
        setTurnSeenAt((seenAt) => (next.agentTurn === null ? null : before.thinking && seenAt !== null ? seenAt : Date.now()));
        seen.current = { changes: next.changes, day: next.day, status: next.status, thinking: next.agentTurn !== null, weeks: next.weeks };
        setStatus(next);
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [router]);

  const act = async (control: SimulationAction) => {
    setBusy(control.action);
    setError(null);
    if (control.action === "step_week" || control.action === "step_day") {
      setStatus((current) => ({
        ...current,
        failed: false,
        status: "stepping",
        step: { kind: control.action === "step_week" ? "week" : "day", week: control.action === "step_week" ? current.weeks + 1 : null },
      }));
      seen.current = { ...seen.current, status: "stepping" };
      pressed.current = { day: status.day, weeks: status.weeks };
    }
    const outcome = await runWebJob<{ ok: true }>("/api/simulation", control);
    // A step still queued after the wait stays pressed; a finished or refused one lets the server's state show again.
    if (outcome.kind !== "pending") pressed.current = null;
    setBusy(null);
    if (outcome.kind === "error") {
      setError(outcome.message);
      return;
    }
    if (control.action === "go_real") {
      window.location.assign("/wizard");
      return;
    }
    if (control.action === "restart") {
      // A new run starts from day 1 with a new journal: a full load is simpler than patching the studio state.
      window.location.assign("/simulation");
      return;
    }
    router.refresh();
  };

  return { status, busy, error, act, turnSeenAt, now };
};
