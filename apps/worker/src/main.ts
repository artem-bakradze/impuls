import { IdlePolicy } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { createDb, createPool } from "@impuls/db";
import { SimulatedPlatform } from "@impuls/platforms";
import type { AdPlatform } from "@impuls/platforms";
import { PgBoss } from "pg-boss";
import { systemClock } from "./clock";
import { loadConfig } from "./config";
import type { JobContext } from "./context";
import { CommandExecutor } from "./executor";
import { createLogger } from "./logger";
import { PgLockManager } from "./pg-locks";
import { PgStore } from "./pg-store";
import { startScheduler } from "./scheduler";
import { SmtpMailer } from "./email";

const logger = createLogger();

const main = async (): Promise<void> => {
  const config = loadConfig(process.env);
  const pool = createPool(config.DATABASE_URL);
  const store = new PgStore(createDb(pool));
  const locks = new PgLockManager(pool);

  let platform: AdPlatform;
  let advance: () => void = () => undefined;
  if (config.DIRECT_API_MODE === "simulator") {
    const simulator = new SimulatedPlatform({
      seed: 1,
      timeZone: "Europe/Moscow",
      now: () => systemClock.now(),
      truthFor: () => ({ impressionsPerDay: 500, ctr: 0.05, cr: 0.06, costPerClick: rubles(25) }),
    });
    platform = simulator;
    advance = () => simulator.advanceHour(systemClock.now());
  } else {
    throw new Error(`DIRECT_API_MODE=${config.DIRECT_API_MODE} requires the Yandex Direct adapter (task 3.3), which is not implemented yet`);
  }

  const executor = new CommandExecutor({ store, locks, clock: systemClock, platformFor: () => platform });
  const ctx: JobContext = { store, clock: systemClock, locks, executor, platformFor: () => platform, agent: new IdlePolicy() };

  const boss = new PgBoss(config.DATABASE_URL);
  boss.on("error", (error) => logger.error("pg-boss error", { error }));
  await boss.start();
  await startScheduler(boss, ctx, logger, advance, { mailer: new SmtpMailer(config.SMTP_URL, config.MAIL_FROM), appUrl: config.APP_URL });
  logger.info("Worker started", { directApiMode: config.DIRECT_API_MODE, agentRuntime: config.AGENT_RUNTIME });

  const shutdown = async (): Promise<void> => {
    await boss.stop();
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
};

main().catch((error: unknown) => {
  logger.error("Worker failed to start", { error });
  process.exit(1);
});
