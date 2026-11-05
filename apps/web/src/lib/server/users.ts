import "server-only";
import { randomUUID } from "node:crypto";
import { eq, schema } from "@impuls/db";
import type { AccountKind, NewAccount } from "@/lib/account-mode";
import { db } from "./runtime";

/**
 * Creates the account on first login (auth spec) or returns the existing one. A demo's subject is new on every press,
 * so it always creates one, without email or name.
 */
export const upsertUser = async (input: NewAccount): Promise<string> => {
  const [existing] = await db().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.googleSub, input.subject));
  if (existing) {
    return existing.id;
  }
  const [created] = await db()
    .insert(schema.users)
    .values({ id: `usr-${randomUUID()}`, googleSub: input.subject, kind: input.kind, email: input.email, name: input.name })
    .onConflictDoUpdate({ target: schema.users.googleSub, set: { email: input.email } })
    .returning({ id: schema.users.id });
  if (!created) {
    throw new Error("Failed to create user");
  }
  return created.id;
};

export const userExists = async (userId: string): Promise<boolean> => {
  const [row] = await db().select({ id: schema.users.id, deletedAt: schema.users.deletedAt }).from(schema.users).where(eq(schema.users.id, userId));
  return row !== undefined && row.deletedAt === null;
};

/** How the account signed in; it decides the business mode (`accountMode`). */
export const userKind = async (userId: string): Promise<AccountKind> => {
  const [row] = await db().select({ kind: schema.users.kind }).from(schema.users).where(eq(schema.users.id, userId));
  if (!row) {
    throw new Error(`User ${userId} not found`);
  }
  return row.kind;
};
