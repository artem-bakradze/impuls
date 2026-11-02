import { HeuristicPolicy, IdlePolicy, LlmCreativeEngine, OpenAiAgentRuntime, OpenAiLlmClient, TemplateCreativeEngine } from "@impuls/agent";
import type { AgentRuntime, CreativeEngine } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { and, createDb, createPool, decryptToken, encryptToken, eq, isNull, parseTokenKey, schema } from "@impuls/db";
import { refreshYandexToken, SimulatedPlatform } from "@impuls/platforms";
import type { AdPlatform } from "@impuls/platforms";
import { PgBoss } from "pg-boss";
import { systemClock } from "./clock";
import { loadConfig } from "./config";
import type { AgentCosts, JobContext } from "./context";
import { CommandExecutor } from "./executor";
import { createLogger } from "./logger";
import { PgLockManager } from "./pg-locks";
import { PgStore } from "./pg-store";
import { startScheduler, WEB_JOB_CONCURRENCY } from "./scheduler";
import { MAX_MOVING_SIMULATIONS, startSimulationTicker } from "./simulation-mode";
import { SmtpMailer } from "./email";
import { FileMiniSiteStore } from "./minisite-store";
import { BusinessDirectPlatform } from "./direct-platform";
import type { DirectTokenSource } from "./direct-platform";
import { createDirectTokenSource } from "./direct-tokens";

const logger = createLogger();
/**
 * Up to three nested locks (simulation or job, agent turn, business) for each of the simulation ticks, web jobs and the
 * hourly dispatch running at once.
 */
const LOCK_POOL_SIZE = 3 * (MAX_MOVING_SIMULATIONS + WEB_JOB_CONCURRENCY + 1);

const main = async (): Promise<void> => {
  const config = loadConfig(process.env);
  const pool = createPool(config.DATABASE_URL);
  const store = new PgStore(createDb(pool));
  // Locks hold their connections while the work inside them queries through the main pool, so they get a pool of
  // their own, sized for the nested locks of the pg-boss handlers and of the simulations moved at once.
  const lockPool = createPool(config.DATABASE_URL, LOCK_POOL_SIZE);
  const locks = new PgLockManager(lockPool);

  let platformFor: (businessId: string) => AdPlatform;
  let advance: () => void = () => undefined;
  if (config.DIRECT_API_MODE === "simulator") {
    const simulator = new SimulatedPlatform({
      seed: 1,
      // A fresh prefix per start: campaigns of the previous run stay in the database (see SimulatorOptions.idPrefix).
      idPrefix: `run${Date.now().toString(36)}-`,
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
    if (config.YANDEX_CLIENT_ID === undefined || config.YANDEX_CLIENT_SECRET === undefined) {
      throw new Error("YANDEX_CLIENT_ID and YANDEX_CLIENT_SECRET are required with DIRECT_API_MODE=production");
    }
    const db = createDb(pool);
    const clientId = config.YANDEX_CLIENT_ID;
    const clientSecret = config.YANDEX_CLIENT_SECRET;
    const tokens: DirectTokenSource = createDirectTokenSource({
      store: {
        read: async (businessId) => {
          const [row] = await db
            .select({
              accessTokenEnc: schema.platformAccounts.accessTokenEnc,
              refreshTokenEnc: schema.platformAccounts.refreshTokenEnc,
              tokenExpiresAt: schema.platformAccounts.tokenExpiresAt,
            })
            .from(schema.platformAccounts)
            .where(and(eq(schema.platformAccounts.businessId, businessId), isNull(schema.platformAccounts.revokedAt)));
          return row ?? null;
        },
        replace: async (businessId, expectedAccessTokenEnc, values) => {
          const updated = await db
            .update(schema.platformAccounts)
            .set(values)
            .where(
              and(
                eq(schema.platformAccounts.businessId, businessId),
                eq(schema.platformAccounts.accessTokenEnc, expectedAccessTokenEnc),
                isNull(schema.platformAccounts.revokedAt),
              ),
            )
            .returning({ businessId: schema.platformAccounts.businessId });
          return updated.length > 0;
        },
      },
      decrypt: (encrypted) => decryptToken(key, encrypted),
      encrypt: (token) => encryptToken(key, token),
      refresh: (refreshToken) => refreshYandexToken(fetch, { clientId, clientSecret }, refreshToken, systemClock.now()),
      now: () => systemClock.now(),
    });
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
  let agent: AgentRuntime;
  let agentCosts: AgentCosts | undefined;
  let strategist: JobContext["strategist"];
  if (config.AGENT_RUNTIME === "openai") {
    const { OPENAI_API_KEY, OPENAI_AGENT_MODEL, AGENT_PRICE_INPUT_RUB_PER_MTOK, AGENT_PRICE_OUTPUT_RUB_PER_MTOK, AGENT_MONTHLY_LIMIT_RUB, AGENT_SIMULATION_RUN_LIMIT_RUB } = config;
    if (!OPENAI_API_KEY || !OPENAI_AGENT_MODEL || !AGENT_PRICE_INPUT_RUB_PER_MTOK || !AGENT_PRICE_OUTPUT_RUB_PER_MTOK || !AGENT_MONTHLY_LIMIT_RUB || !AGENT_SIMULATION_RUN_LIMIT_RUB) {
      throw new Error("The model, its prices and the spend limits are required with AGENT_RUNTIME=openai");
    }
    agent = new OpenAiAgentRuntime({ apiKey: OPENAI_API_KEY, model: OPENAI_AGENT_MODEL, ...(config.OPENAI_PROXY_URL !== undefined && { proxyUrl: config.OPENAI_PROXY_URL }) });
    agentCosts = {
      inputKopecksPerMTok: Math.round(AGENT_PRICE_INPUT_RUB_PER_MTOK * 100),
      outputKopecksPerMTok: Math.round(AGENT_PRICE_OUTPUT_RUB_PER_MTOK * 100),
      monthlyLimitKopecks: Math.round(AGENT_MONTHLY_LIMIT_RUB * 100),
      simulationRunLimitKopecks: Math.round(AGENT_SIMULATION_RUN_LIMIT_RUB * 100),
    };
    const { OPENAI_STRATEGY_MODEL, AGENT_STRATEGY_PRICE_INPUT_RUB_PER_MTOK, AGENT_STRATEGY_PRICE_OUTPUT_RUB_PER_MTOK } = config;
    if (OPENAI_STRATEGY_MODEL) {
      if (!AGENT_STRATEGY_PRICE_INPUT_RUB_PER_MTOK || !AGENT_STRATEGY_PRICE_OUTPUT_RUB_PER_MTOK) {
        throw new Error("The strategy model's prices are required with OPENAI_STRATEGY_MODEL");
      }
      strategist = {
        runtime: new OpenAiAgentRuntime({ apiKey: OPENAI_API_KEY, model: OPENAI_STRATEGY_MODEL, ...(config.OPENAI_PROXY_URL !== undefined && { proxyUrl: config.OPENAI_PROXY_URL }) }),
        costs: {
          ...agentCosts,
          inputKopecksPerMTok: Math.round(AGENT_STRATEGY_PRICE_INPUT_RUB_PER_MTOK * 100),
          outputKopecksPerMTok: Math.round(AGENT_STRATEGY_PRICE_OUTPUT_RUB_PER_MTOK * 100),
        },
      };
    }
  } else {
    agent = config.AGENT_RUNTIME === "heuristic" ? new HeuristicPolicy() : new IdlePolicy();
  }
  const ctx: JobContext = {
    store,
    clock: systemClock,
    locks,
    executor,
    platformFor,
    agent,
    creatives,
    ...(agentCosts !== undefined && { agentCosts }),
    ...(strategist !== undefined && { strategist }),
  };

  const boss = new PgBoss(config.DATABASE_URL);
  boss.on("error", (error) => logger.error("pg-boss error", { error }));
  await boss.start();
  await startScheduler(boss, ctx, logger, advance, { mailer: new SmtpMailer(config.SMTP_URL, config.MAIL_FROM), appUrl: config.APP_URL, teamEmail: config.TEAM_ALERT_EMAIL });
  // Businesses in the simulation mode live on their own virtual clocks (add-simulation-mode decision 4).
  const stopTicker = startSimulationTicker(ctx, logger);
  logger.info("Worker started", { directApiMode: config.DIRECT_API_MODE, agentRuntime: config.AGENT_RUNTIME, creatives: config.CREATIVES, textModel: config.OPENAI_TEXT_MODEL ?? null, agentModel: config.OPENAI_AGENT_MODEL ?? null, strategyModel: config.OPENAI_STRATEGY_MODEL ?? null });

  const shutdown = async (): Promise<void> => {
    stopTicker();
    await boss.stop();
    await lockPool.end();
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
};

main().catch((error: unknown) => {
  logger.error("Worker failed to start", { error });
  process.exit(1);
});
