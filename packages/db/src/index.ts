import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export * as schema from "./schema";

/** Requires DATABASE_URL; fails fast when it is missing (No-Fallbacks policy). */
export const databaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is required");
  }
  return url;
};

export const createPool = (url: string = databaseUrl()): pg.Pool => new pg.Pool({ connectionString: url });

export const createDb = (pool: pg.Pool) => drizzle(pool, { schema });
export type Db = ReturnType<typeof createDb>;
