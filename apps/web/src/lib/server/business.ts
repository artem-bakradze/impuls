import "server-only";
import { randomUUID } from "node:crypto";
import { asc, eq, schema } from "@impuls/db";
import { agentCard, emptyDraft, interimAutoGoalRub, OnboardingDraftSchema, withCity } from "../onboarding";
import type { OnboardingDraft } from "../onboarding";
import { db } from "./runtime";

export type BusinessRow = typeof schema.businesses.$inferSelect;

/** The wizard answers live next to the allowlisted card fields; the agent snapshot never reads this key. */
const DRAFT_KEY = "onboarding";

export const findBusiness = async (userId: string): Promise<BusinessRow | null> => {
  const [row] = await db().select().from(schema.businesses).where(eq(schema.businesses.userId, userId)).orderBy(asc(schema.businesses.createdAt)).limit(1);
  return row ?? null;
};

export const readDraft = (row: BusinessRow | null): OnboardingDraft => {
  if (row === null) {
    return emptyDraft();
  }
  const stored = (row.card as Record<string, unknown>)[DRAFT_KEY];
  if (stored === undefined) {
    return emptyDraft();
  }
  return withCity(OnboardingDraftSchema.parse(stored));
};

/** The wizard does not ask for a goal: it starts in automatic selection (business-onboarding spec). */
const goalKopecks = (draft: OnboardingDraft): { csoMode: "auto"; csoValue: number } => {
  const budget = draft.budget.monthlyBudgetRub;
  return { csoMode: "auto", csoValue: budget === null ? 0 : interimAutoGoalRub(budget) * 100 };
};

/**
 * Saves wizard progress after each step (business-onboarding spec). Budget and goal stay 0 until the
 * «Бюджет» step is completed; the worker reads them only after launch.
 */
export const saveOnboarding = async (userId: string, step: number, draft: OnboardingDraft): Promise<BusinessRow> => {
  const existing = await findBusiness(userId);
  const values = {
    timeZone: draft.card.timeZone,
    monthlyBudgetRub: draft.budget.monthlyBudgetRub ?? 0,
    ...goalKopecks(draft),
    card: { ...agentCard(draft), [DRAFT_KEY]: draft },
    onboardingStep: step,
  };
  if (existing) {
    const [row] = await db().update(schema.businesses).set(values).where(eq(schema.businesses.id, existing.id)).returning();
    if (!row) {
      throw new Error(`Business ${existing.id} disappeared while saving`);
    }
    return row;
  }
  const [row] = await db()
    .insert(schema.businesses)
    .values({ id: `biz-${randomUUID()}`, userId, ...values })
    .returning();
  if (!row) {
    throw new Error("Failed to create business");
  }
  return row;
};

