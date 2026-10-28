import type pg from "pg";
import type { LockManager } from "./locks";

/**
 * Session-level advisory locks on a dedicated connection (design decision 3).
 * Writes made inside `fn` use other connections and commit independently, so a `pending`
 * change survives a crash; if the worker dies, the session ends and the lock is released.
 */
export class PgLockManager implements LockManager {
  constructor(private readonly pool: pg.Pool) {}

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [key]);
      try {
        return await fn();
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]);
      }
    } finally {
      client.release();
    }
  }

  async tryWithLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [key]);
      if (result.rows[0]?.locked !== true) {
        return null;
      }
      try {
        return await fn();
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]);
      }
    } finally {
      client.release();
    }
  }
}
