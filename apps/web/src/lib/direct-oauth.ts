/**
 * Connecting the owner's Yandex Direct account (platform-integration spec, replace-direct-sandbox decision 4).
 * Uses the Yandex OAuth app «для авторизации пользователей»; the debug app is never used here.
 * The code exchange is the only external call web makes (AGENTS.md).
 */

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;
export const DIRECT_OAUTH_CALLBACK_PATH = "/api/direct/oauth/callback";

export interface DirectOAuthConfig {
  clientId: string;
  clientSecret: string;
  appUrl: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

export interface DirectOAuthDeps {
  now(): Date;
  randomState(): string;
  saveState(entry: { state: string; userId: string; expiresAt: Date }): Promise<void>;
  /** Deletes the state and reports whether it was issued to this user and has not expired. */
  consumeState(state: string, userId: string, now: Date): Promise<boolean>;
  exchangeCode(code: string): Promise<TokenSet>;
  saveAccount(userId: string, tokens: TokenSet): Promise<void>;
}

export type DirectOAuthOutcome = "connected" | "denied" | "failed";

export const redirectUri = (config: DirectOAuthConfig): string => new URL(DIRECT_OAUTH_CALLBACK_PATH, config.appUrl).toString();

/** Issues a one-time `state` bound to the user and returns the Yandex consent URL. */
export const startAuthorization = async (deps: DirectOAuthDeps, config: DirectOAuthConfig, userId: string): Promise<string> => {
  const state = deps.randomState();
  await deps.saveState({ state, userId, expiresAt: new Date(deps.now().getTime() + OAUTH_STATE_TTL_MS) });
  const url = new URL("https://oauth.yandex.ru/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(config));
  url.searchParams.set("state", state);
  // Always show the consent screen, so the owner sees which account is being connected.
  url.searchParams.set("force_confirm", "yes");
  return url.toString();
};

/**
 * Handles the redirect back from Yandex. The state is consumed before anything else, so a forged or replayed
 * answer never reaches the code exchange; a declined consent stores nothing.
 */
export const finishAuthorization = async (deps: DirectOAuthDeps, params: URLSearchParams, userId: string): Promise<DirectOAuthOutcome> => {
  const state = params.get("state");
  if (state === null || !(await deps.consumeState(state, userId, deps.now()))) {
    return "failed";
  }
  if (params.get("error") === "access_denied") {
    return "denied";
  }
  const code = params.get("code");
  if (code === null || code === "") {
    return "failed";
  }
  await deps.saveAccount(userId, await deps.exchangeCode(code));
  return "connected";
};

export class TokenExchangeError extends Error {
  constructor(readonly status: number) {
    super(`Yandex OAuth token exchange failed with HTTP ${status}`);
    this.name = "TokenExchangeError";
  }
}

/** `POST https://oauth.yandex.ru/token` with the authorization code. */
export const exchangeCodeWithYandex = async (fetchImpl: typeof fetch, config: DirectOAuthConfig, code: string, now: Date): Promise<TokenSet> => {
  const response = await fetchImpl("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: config.clientId, client_secret: config.clientSecret }).toString(),
  });
  if (!response.ok) {
    throw new TokenExchangeError(response.status);
  }
  const body = (await response.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new TokenExchangeError(response.status);
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: typeof body.expires_in === "number" ? new Date(now.getTime() + body.expires_in * 1_000) : null,
  };
};

/** Plain-language result on the «Подключение Директа» step after the redirect back. */
export const DIRECT_OAUTH_MESSAGES: Record<Exclude<DirectOAuthOutcome, "connected">, string> = {
  denied: "Без доступа к Яндекс Директу мы не сможем запустить рекламу",
  failed: "Не удалось подключить Яндекс Директ — попробуйте ещё раз",
};
