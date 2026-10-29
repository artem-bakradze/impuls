import { IdlePolicy, LlmCreativeEngine, OpenAiLlmClient, TemplateCreativeEngine } from "@impuls/agent";
import type { CreativeEngine } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { and, createDb, createPool, decryptToken, eq, isNull, parseTokenKey, schema } from "@impuls/db";
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
import { FileMiniSiteStore } from "./minisite-store";
import { BusinessDirectPlatform } from "./direct-platform";
import type { DirectTokenSource } from "./direct-platform";

const logger = createLogger();

const main = async (): Promise<void> => {
  const config = loadConfig(process.env);
  const pool = createPool(config.DATABASE_URL);
  const store = new PgStore(createDb(pool));
  const locks = new PgLockManager(pool);

  let platformFor: (businessId: string) => AdPlatform;
  let advance: () => void = () => undefined;
  if (config.DIRECT_API_MODE === "simulator") {
    const simulator = new SimulatedPlatform({
      seed: 1,
      timeZone: "Europe/Moscow",
      now: () => systemClock.now(),
      truthFor: () => ({ impressionsPerDay: 500, ctr: 0.05, cr: 0.06, costPerClick: rubles(25) }),
    });
    platformFor = () => simulator;
    advance = () => simulator.advanceHour(systemClock.now());
  } else {
    if (config.TOKEN_ENCRYPTION_KEY === undefined) {
      throw new Error("TOKEN_ENCRYPTION_KEY is required with DIRECT_API_MODE=production");
    }
    const key = parseTokenKey(config.TOKEN_ENCRYPTION_KEY);
    const db = createDb(pool);
    const tokens: DirectTokenSource = async (businessId) => {
      const [row] = await db
        .select({ token: schema.platformAccounts.accessTokenEnc })
        .from(schema.platformAccounts)
        .where(and(eq(schema.platformAccounts.businessId, businessId), isNull(schema.platformAccounts.revokedAt)));
      return row ? decryptToken(key, row.token) : null;
    };
    // The request journal (platform-integration spec) goes to the structured log, never with the token.
    platformFor = (businessId) => new BusinessDirectPlatform(businessId, tokens, (entry) => logger.info("Direct API request", { ...entry }));
  }

  const executor = new CommandExecutor({ store, locks, clock: systemClock, platformFor, miniSites: new FileMiniSiteStore(config.MINISITE_DIR) });
  let creatives: CreativeEngine;
  if (config.CREATIVES === "openai") {
    if (!config.OPENAI_API_KEY || !config.OPENAI_TEXT_MODEL) {
      throw new Error("OPENAI_API_KEY and OPENAI_TEXT_MODEL are required with CREATIVES=openai");
    }
    creatives = new LlmCreativeEngine(
      new OpenAiLlmClient({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_TEXT_MODEL, ...(config.OPENAI_PROXY_URL !== undefined && { proxyUrl: config.OPENAI_PROXY_URL }) }),
    );
  } else {
    creatives = new TemplateCreativeEngine();
  }
  const ctx: JobContext = { store, clock: systemClock, locks, executor, platformFor, agent: new IdlePolicy(), creatives };

  const boss = new PgBoss(config.DATABASE_URL);
  boss.on("error", (error) => logger.error("pg-boss error", { error }));
  await boss.start();
  await startScheduler(boss, ctx, logger, advance, { mailer: new SmtpMailer(config.SMTP_URL, config.MAIL_FROM), appUrl: config.APP_URL, teamEmail: config.TEAM_ALERT_EMAIL });
  logger.info("Worker started", { directApiMode: config.DIRECT_API_MODE, agentRuntime: config.AGENT_RUNTIME, creatives: config.CREATIVES, textModel: config.OPENAI_TEXT_MODEL ?? null });

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
