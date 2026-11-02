import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./index";

/**
 * Applies the generated migrations from `drizzle/` (the same ones `drizzle-kit migrate` runs). A separate entry
 * point, so the web bundle never sees the migrations folder.
 */
export const migrateToLatest = (db: Db): Promise<void> => migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
