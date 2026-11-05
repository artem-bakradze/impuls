"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { callApi, waitForJob } from "@/lib/client-api";
import type { SimulationAction, SimulationStatus } from "@/lib/simulation-model";

/**
 * The simulation's clock on «Реклама»: polls the virtual day, refreshes the server page only when a period is over, and
 * sends the owner's periods. It never walks the time by itself: every period is a deliberate press. Without a
 * simulation (Direct) it is given null and does nothing, so the screen calls it the same way in both modes.
 */
export const useSimulation = (initial: SimulationStatus | null) => {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turnSeenAt, setTurnSeenAt] = useState<number | null>(initial?.agentTurn ? Date.now() : null);
  const [now, setNow] = useState(() => Date.now());
  const simulated = useRef(initial !== null);
  const seen = useRef({
    changes: initial?.changes ?? 0,
    status: initial?.status ?? "paused",
    thinking: initial?.agentTurn ?? false,
  });
  /**
   * A period the server took that the worker has not started: until then the server still says «paused» about the day
   * before, and that must not put «прожит» back on the screen (simulation-mode spec: a period that is not over is not
   * shown as lived). Cleared when the server shows the period moving or failing, or when its job ends.
   */
  const pressed = useRef<{ day: number; periods: number } | null>(null);

  useEffect(() => {
    if (!simulated.current) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void callApi<SimulationStatus>("/api/simulation", "GET").then((result) => {
        if (result.kind !== "ok") return;
        const next = result.body;
        const waiting = pressed.current;
        if (waiting !== null) {
          const moved = next.status === "stepping" || next.failed === true || next.day !== waiting.day || next.periods !== waiting.periods;
          if (!moved) return;
          pressed.current = null;
        }
        const before = seen.current;
        // The page's numbers wait for the end of a period; meanwhile only the player moves.
        if (next.status === "paused" && (before.status === "stepping" || next.changes !== before.changes)) {
          router.refresh();
        }
        setTurnSeenAt((seenAt) => (!next.agentTurn ? null : before.thinking && seenAt !== null ? seenAt : Date.now()));
        seen.current = { changes: next.changes, status: next.status, thinking: next.agentTurn };
        setStatus(next);
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [router]);

  /**
   * Sends a player action. A refusal of the server is returned (and shown by the player unless it is a period's, which
   * its window shows); `onAccepted` runs as soon as the server took the action, before the worker is done with it.
   */
  const act = async (control: SimulationAction, onAccepted?: () => void): Promise<{ code: string; message: string } | null> => {
    if (status === null) return null;
    setBusy(control.action);
    setError(null);
    const started = await callApi<{ jobId: string }>("/api/simulation", "POST", control);
    if (started.kind === "error") {
      setBusy(null);
      if (control.action !== "period") setError(started.message);
      return { code: started.code, message: started.message };
    }
    onAccepted?.();
    if (control.action === "period" || control.action === "continue") {
      const step = control.action === "period" ? { from: status.day, to: status.day + control.days - 1 } : status.step;
      setStatus((current) => (current === null ? current : { ...current, failed: false, status: "stepping", step }));
      seen.current = { ...seen.current, status: "stepping" };
      pressed.current = { day: status.day, periods: status.periods };
    }
    const outcome = await waitForJob<{ ok: true }>(started.body.jobId);
    // A period still queued after the wait stays pressed; a finished or refused one lets the server's state show again.
    if (outcome.kind !== "pending") pressed.current = null;
    setBusy(null);
    if (outcome.kind === "error") {
      setError(outcome.message);
      return null;
    }
    if (control.action === "go_real" || control.action === "new_campaign") {
      window.location.assign("/wizard");
      return null;
    }
    if (control.action === "restart") {
      // A new run starts from day 1 with a new journal: a full load is simpler than patching the screen's state.
      window.location.assign("/summary");
      return null;
    }
    router.refresh();
    return null;
  };

  return { status, busy, error, act, turnSeenAt, now };
};
