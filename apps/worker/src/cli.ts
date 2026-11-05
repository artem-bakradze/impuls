import { monthKey, toLocalDate } from "@impuls/core";
import { createDb, createPool, databaseUrl } from "@impuls/db";
import { PgBoss } from "pg-boss";
import { createLogger } from "./logger";
import type { Logger } from "./logger";
import { PgStore } from "./pg-store";
import type { FlagName } from "./store";
import { WEB_JOB_QUEUE } from "./web-jobs";
import type { WebJob } from "./web-jobs";

const FLAGS: readonly FlagName[] = ["agent_enabled", "automation_enabled"];
const USAGE = [
  "Usage: pnpm --filter @impuls/worker cli flags set <agent_enabled|automation_enabled> <on|off> [--business <id>]",
  "       pnpm --filter @impuls/worker cli account delete <businessId>",
  "       pnpm --filter @impuls/worker cli agent costs --month [YYYY-MM]",
].join("\n");

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Model spend of the agent per business (add-agent-insights task 1.3): turns started in the month in the business's
 * time zone; a simulation runs on virtual time, so its line is the spend of the current run.
 */
const agentCosts = async (store: PgStore, month: string, logger: Logger): Promise<void> => {
  for (const business of await store.listBusinesses()) {
    const turns = await store.turns(business.id);
    const counted = business.mode === "simulation" ? turns : turns.filter((t) => monthKey(toLocalDate(t.startedAt, business.timeZone)) === month);
    const kopecks = counted.reduce((sum, t) => sum + t.costKopecks, 0);
    // Paid ad pictures of the month in the business's time zone (network-ad-images): their cost is this count times
    // IMAGE_PRICE_RUB. A day before the month's UTC start covers every time zone.
    const since = new Date(Date.parse(`${month}-01T00:00:00Z`) - 86_400_000);
    const pictures = (await store.generatedImageTimes(business.id, since)).filter((at) => monthKey(toLocalDate(at, business.timeZone)) === month).length;
    logger.info("Agent costs", {
      businessId: business.id,
      period: business.mode === "simulation" ? "simulation_run" : month,
      turns: counted.length,
      estimatedTurns: counted.filter((t) => t.usageSource === "estimate").length,
      costRub: kopecks / 100,
      paidPictures: pictures,
    });
  }
};

/** Sends a job to the running worker, which executes it with its own platform wiring. */
export type JobSender = (job: WebJob) => Promise<string>;

/**
 * Ops CLI (design decision 13): kill switches take effect on the next job or tool call; account deletion on the
 * owner's request to support (auth spec) is queued to the worker, which stops the ads and revokes the tokens.
 */
export const runCli = async (args: readonly string[], store: PgStore, send: JobSender, logger = createLogger(), now = new Date()): Promise<void> => {
  const [scope, action, name, value, flag, businessId] = args;
  if (scope === "agent" && action === "costs" && name === "--month" && flag === undefined) {
    if (value !== undefined && !MONTH.test(value)) {
      throw new Error(USAGE);
    }
    await agentCosts(store, value ?? now.toISOString().slice(0, 7), logger);
    return;
  }
  if (scope === "account" && action === "delete" && name !== undefined && value === undefined) {
    await store.getBusiness(name);
    const jobId = await send({ kind: "delete_account", businessId: name });
    logger.info("Account deletion queued", { businessId: name, jobId });
    return;
  }
  if (scope !== "flags" || action !== "set" || !FLAGS.includes(name as FlagName) || (value !== "on" && value !== "off")) {
    throw new Error(USAGE);
  }
  if (flag !== undefined && (flag !== "--business" || businessId === undefined)) {
    throw new Error(USAGE);
  }
  await store.setFlag(name as FlagName, value === "on", businessId ?? null);
  logger.info("Kill switch changed", { flag: name, enabled: value === "on", businessId: businessId ?? "*" });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = databaseUrl();
  const pool = createPool(url);
  const boss = new PgBoss(url);
  const send: JobSender = async (job) => {
    await boss.start();
    const id = await boss.send(WEB_JOB_QUEUE, job);
    if (id === null) {
      throw new Error("pg-boss did not accept the job");
    }
    return id;
  };
  runCli(process.argv.slice(2), new PgStore(createDb(pool)), send)
    .then(async () => {
      await boss.stop();
      await pool.end();
    })
    .catch(async (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      await boss.stop();
      await pool.end();
      process.exit(1);
    });
}
