import "server-only";
import { randomBytes } from "node:crypto";
import { encryptToken, eq, parseTokenKey, schema } from "@impuls/db";
import { exchangeCodeWithYandex } from "../direct-oauth";
import type { DirectOAuthConfig, DirectOAuthDeps } from "../direct-oauth";
import { createOAuthStateStore } from "../oauth-state-store";
import { findBusiness, readDraft, saveOnboarding } from "./business";
import { webConfig } from "./config";
import { db } from "./runtime";

/** Production-only settings, validated at startup by the web config (required with DIRECT_API_MODE=production). */
export const directOAuthConfig = (): DirectOAuthConfig & { tokenKey: Buffer } => {
  const config = webConfig();
  if (config.DIRECT_API_MODE !== "production" || !config.YANDEX_CLIENT_ID || !config.YANDEX_CLIENT_SECRET || !config.APP_URL || !config.TOKEN_ENCRYPTION_KEY) {
    throw new Error("Direct OAuth is available only with DIRECT_API_MODE=production and its configuration");
  }
  return {
    clientId: config.YANDEX_CLIENT_ID,
    clientSecret: config.YANDEX_CLIENT_SECRET,
    appUrl: config.APP_URL,
    tokenKey: parseTokenKey(config.TOKEN_ENCRYPTION_KEY),
  };
};

export const hasDirectAccount = async (businessId: string): Promise<boolean> => {
  const [row] = await db()
    .select({ businessId: schema.platformAccounts.businessId })
    .from(schema.platformAccounts)
    .where(eq(schema.platformAccounts.businessId, businessId))
    .limit(1);
  return row !== undefined;
};

export const directOAuthDeps = (): DirectOAuthDeps => {
  const config = directOAuthConfig();
  const states = createOAuthStateStore(db());
  return {
    now: () => new Date(),
    randomState: () => randomBytes(32).toString("base64url"),
    saveState: states.save,
    consumeState: states.consume,
    exchangeCode: (code) => exchangeCodeWithYandex(fetch, config, code, new Date()),
    saveAccount: async (userId, tokens) => {
      const business = await findBusiness(userId);
      if (!business) {
        throw new Error("Direct account connected for a user without a business");
      }
      const values = {
        platform: "yandex-direct",
        login: null,
        accessTokenEnc: encryptToken(config.tokenKey, tokens.accessToken),
        refreshTokenEnc: tokens.refreshToken === null ? null : encryptToken(config.tokenKey, tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        revokedAt: null,
      };
      await db()
        .insert(schema.platformAccounts)
        .values({ businessId: business.id, ...values })
        .onConflictDoUpdate({ target: schema.platformAccounts.businessId, set: values });
      await saveOnboarding(userId, business.onboardingStep, { ...readDraft(business), directConnected: true });
    },
  };
};
