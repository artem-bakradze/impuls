import "server-only";
import { createDb, createPool } from "@impuls/db";
import type { Db } from "@impuls/db";
import { PgStore } from "@impuls/worker";
import { PgBoss } from "pg-boss";
import type pg from "pg";
import { webConfig } from "./config";
import { logger } from "./logger";

interface Runtime {
  pool: pg.Pool;
  db: Db;
  store: PgStore;
  boss: Promise<PgBoss> | null;
}

const globalRuntime = globalThis as typeof globalThis & { __impulsRuntime?: Runtime };

/** One pool per process (also across dev hot reloads). web only reads PostgreSQL and enqueues jobs. */
const runtime = (): Runtime => {
  if (!globalRuntime.__impulsRuntime) {
    const pool = createPool(webConfig().DATABASE_URL);
    const db = createDb(pool);
    globalRuntime.__impulsRuntime = { pool, db, store: new PgStore(db), boss: null };
  }
  return globalRuntime.__impulsRuntime;
};

export const db = (): Db => runtime().db;
export const store = (): PgStore => runtime().store;

/**
 * pg-boss client used only to send web jobs and read their results. It does not run maintenance,
 * schedules or migrations: the worker owns the queue schema.
 */
export const boss = (): Promise<PgBoss> => {
  const rt = runtime();
  if (rt.boss === null) {
    const client = new PgBoss({ connectionString: webConfig().DATABASE_URL, supervise: false, schedule: false, migrate: false });
    client.on("error", (error) => logger.error("pg-boss error", { error }));
    rt.boss = client.start().then(
      () => client,
      (error: unknown) => {
        rt.boss = null;
        throw error;
      },
    );
  }
  return rt.boss;
};
