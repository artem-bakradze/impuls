import { createDb, createPool, databaseUrl } from "@impuls/db";
import { createLogger } from "./logger";
import { PgStore } from "./pg-store";
import type { FlagName } from "./store";

const FLAGS: readonly FlagName[] = ["agent_enabled", "automation_enabled"];
const USAGE = "Usage: pnpm --filter @impuls/worker cli flags set <agent_enabled|automation_enabled> <on|off> [--business <id>]";

/** Ops CLI for kill switches (design decision 13). Takes effect on the next job or tool call. */
export const runCli = async (args: readonly string[], store: PgStore, logger = createLogger()): Promise<void> => {
  const [scope, action, name, value, flag, businessId] = args;
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
  const pool = createPool(databaseUrl());
  runCli(process.argv.slice(2), new PgStore(createDb(pool)))
    .then(() => pool.end())
    .catch(async (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      await pool.end();
      process.exit(1);
    });
}
