import type { YandexTokenSet } from "@impuls/platforms";

/** Encrypted token row of the connected Direct account. */
export interface DirectTokenRow {
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  tokenExpiresAt: Date | null;
}

/** Storage of the account's tokens; `replace` is a compare-and-set on the access token it refreshes from. */
export interface DirectTokenStore {
  read(businessId: string): Promise<DirectTokenRow | null>;
  replace(businessId: string, expectedAccessTokenEnc: string, values: DirectTokenRow): Promise<boolean>;
}

export interface DirectTokenSourceOptions {
  store: DirectTokenStore;
  decrypt(encrypted: string): string;
  encrypt(token: string): string;
  refresh(refreshToken: string): Promise<YandexTokenSet>;
  now(): Date;
  /** Refresh this long before the token expires; Yandex access tokens live a year. */
  refreshBeforeMs?: number;
}

const DEFAULT_REFRESH_BEFORE_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Decrypted access token of the business, renewed before it expires (platform-integration spec: «Токены MUST …
 * обновляться автоматически»). Without a refresh token the current token is returned: an expired one is rejected by
 * Direct and follows the usual lost-access path, so nothing pretends the account still works.
 */
export const createDirectTokenSource = (options: DirectTokenSourceOptions) => {
  const refreshBeforeMs = options.refreshBeforeMs ?? DEFAULT_REFRESH_BEFORE_MS;
  return async (businessId: string): Promise<string | null> => {
    const row = await options.store.read(businessId);
    if (row === null) return null;
    const due = row.tokenExpiresAt !== null && row.tokenExpiresAt.getTime() - options.now().getTime() <= refreshBeforeMs;
    if (!due || row.refreshTokenEnc === null) return options.decrypt(row.accessTokenEnc);

    const next = await options.refresh(options.decrypt(row.refreshTokenEnc));
    const values: DirectTokenRow = {
      accessTokenEnc: options.encrypt(next.accessToken),
      refreshTokenEnc: next.refreshToken === null ? row.refreshTokenEnc : options.encrypt(next.refreshToken),
      tokenExpiresAt: next.expiresAt,
    };
    if (await options.store.replace(businessId, row.accessTokenEnc, values)) return next.accessToken;

    // Another job refreshed the same account first: use its token instead of overwriting it.
    const fresh = await options.store.read(businessId);
    return fresh === null ? null : options.decrypt(fresh.accessTokenEnc);
  };
};
