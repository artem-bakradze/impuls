"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PENDING_TEXT, runWebJobs } from "@/lib/client-api";
import type { CommandResult } from "@/lib/client-api";

export type Feedback = { id: string; type: "success" | "error" | "info"; text: string } | null;

/** The owner's commands from an ad row: the same web route and executor as everywhere else. */
export const useCommands = () => {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const run = async (id: string, body: unknown, success: string): Promise<boolean> => {
    setBusy(id);
    const outcome = await runWebJobs<CommandResult>("/api/commands", body);
    setBusy(null);
    if (outcome.kind === "pending") {
      setFeedback({ id, type: "info", text: PENDING_TEXT });
      return false;
    }
    if (outcome.kind === "error") {
      setFeedback({ id, type: "error", text: outcome.message });
      return false;
    }
    const failed = outcome.output.find((r) => r.status === "rejected" || r.status === "failed");
    setFeedback(failed ? { id, type: "error", text: `Не получилось: ${failed.message}` } : { id, type: "success", text: success });
    if (!failed) router.refresh();
    return !failed;
  };
  return { busy, feedback, run };
};
