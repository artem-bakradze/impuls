/**
 * Yandex OAuth token refresh (platform-integration spec: tokens renew automatically).
 * The app that owns the tokens is the user-authorization app, never the debug one.
 */

export interface YandexOAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface YandexTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

export class YandexTokenRefreshError extends Error {
  constructor(readonly status: number) {
    super(`Yandex OAuth token refresh failed with HTTP ${status}`);
    this.name = "YandexTokenRefreshError";
  }
}

/** `POST https://oauth.yandex.ru/token` with `grant_type=refresh_token`. */
export const refreshYandexToken = async (
  fetchImpl: typeof fetch,
  client: YandexOAuthClient,
  refreshToken: string,
  now: Date,
): Promise<YandexTokenSet> => {
  const response = await fetchImpl("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }).toString(),
  });
  if (!response.ok) {
    throw new YandexTokenRefreshError(response.status);
  }
  const body = (await response.json()) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new YandexTokenRefreshError(response.status);
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresAt: typeof body.expires_in === "number" ? new Date(now.getTime() + body.expires_in * 1_000) : null,
  };
};
