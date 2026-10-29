import { and, eq, gte, schema } from "@impuls/db";
import type { Db } from "@impuls/db";

/** One-time OAuth `state` values in PostgreSQL: deleting on use makes a replayed answer fail. */
export const createOAuthStateStore = (db: Db) => ({
  save: async (entry: { state: string; userId: string; expiresAt: Date }): Promise<void> => {
    await db.insert(schema.oauthStates).values(entry);
  },
  consume: async (state: string, userId: string, now: Date): Promise<boolean> => {
    const deleted = await db
      .delete(schema.oauthStates)
      .where(and(eq(schema.oauthStates.state, state), eq(schema.oauthStates.userId, userId), gte(schema.oauthStates.expiresAt, now)))
      .returning({ state: schema.oauthStates.state });
    return deleted.length === 1;
  },
});
