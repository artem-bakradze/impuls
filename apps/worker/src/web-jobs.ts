import type { Command, LocalDate } from "@impuls/core";
import { decideApproval, enqueueAgentEvent } from "./agent-turn";
import { confirmClients } from "./analytics";
import { changeBudget } from "./budget-settings";
import type { JobContext } from "./context";
import { rollback } from "./history";
import { deleteAccount } from "./account";
import { launchAds } from "./launch";
import type { LaunchPlan } from "./launch";

/** Jobs that `web` enqueues; only the worker executes them (design decision 3). */
export type WebJob =
  | { kind: "command"; businessId: string; command: Command; explanation: string }
  | { kind: "rollback"; businessId: string; entryId: string; includeLater?: boolean; confirmDifference?: boolean }
  | { kind: "budget"; businessId: string; monthlyBudgetRub: number; confirmed: boolean }
  | { kind: "approval"; businessId: string; approvalId: string; approve: boolean }
  | { kind: "clients"; businessId: string; week: LocalDate; clients: number }
  | { kind: "launch"; businessId: string; plan: LaunchPlan }
  | { kind: "delete_account"; businessId: string };

export const WEB_JOB_QUEUE = "web-job";

const SETTINGS_COMMANDS = new Set<Command["type"]>(["UpdateSchedule", "UpdateGeo", "UpdateMiniSite", "PauseAll", "ResumeAll"]);

/** Executes a web job and returns a JSON-serializable result for the UI. */
export const handleWebJob = async (ctx: JobContext, job: WebJob): Promise<unknown> => {
  switch (job.kind) {
    case "command": {
      const result = await ctx.executor.execute({ businessId: job.businessId, command: job.command, actor: "user", reasonCode: "USER_CHANGE", explanation: job.explanation });
      if ((result.status === "applied" || result.status === "clamped") && SETTINGS_COMMANDS.has(job.command.type)) {
        await enqueueAgentEvent(ctx, job.businessId, { kind: "settings_changed" });
      }
      return result;
    }
    case "rollback":
      return rollback(ctx, {
        businessId: job.businessId,
        entryId: job.entryId,
        ...(job.includeLater !== undefined ? { includeLater: job.includeLater } : {}),
        ...(job.confirmDifference !== undefined ? { confirmDifference: job.confirmDifference } : {}),
      });
    case "budget": {
      const result = await changeBudget(ctx, job.businessId, job.monthlyBudgetRub, job.confirmed);
      if (result.applied) {
        await enqueueAgentEvent(ctx, job.businessId, { kind: "settings_changed" });
      }
      return result;
    }
    case "approval":
      return decideApproval(ctx, job.businessId, job.approvalId, job.approve);
    case "clients":
      await confirmClients(ctx, job.businessId, job.week, job.clients);
      return { ok: true };
    case "launch":
      return launchAds(ctx, job.businessId, job.plan);
    case "delete_account":
      return deleteAccount(ctx, job.businessId);
  }
};
