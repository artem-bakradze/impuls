import { describe, expect, it } from "vitest";
import type { YandexTokenSet } from "@impuls/platforms";
import { createDirectTokenSource } from "./direct-tokens";
import type { DirectTokenRow, DirectTokenStore } from "./direct-tokens";

const now = new Date("2026-11-02T10:00:00Z");
const DAY = 24 * 60 * 60 * 1_000;

const row = (patch: Partial<DirectTokenRow> = {}): DirectTokenRow => ({
  accessTokenEnc: "enc:old",
  refreshTokenEnc: "enc:refresh",
  tokenExpiresAt: new Date(now.getTime() + 300 * DAY),
  ...patch,
});

const fakeStore = (initial: DirectTokenRow | null) => {
  let current = initial;
  const calls = { read: 0, replace: 0 };
  const store: DirectTokenStore = {
    read: () => {
      calls.read += 1;
      return Promise.resolve(current);
    },
    replace: (_businessId, expected, values) => {
      calls.replace += 1;
      if (current === null || current.accessTokenEnc !== expected) return Promise.resolve(false);
      current = values;
      return Promise.resolve(true);
    },
  };
  return { store, calls, current: () => current };
};

const source = (
  store: DirectTokenStore,
  refresh: (refreshToken: string) => Promise<YandexTokenSet> = () =>
    Promise.resolve({ accessToken: "new", refreshToken: "refresh-2", expiresAt: new Date(now.getTime() + 365 * DAY) }),
) =>
  createDirectTokenSource({
    store,
    decrypt: (value) => value.replace(/^enc:/u, ""),
    encrypt: (value) => `enc:${value}`,
    refresh,
    now: () => now,
  });

describe("Direct token source", () => {
  it("returns null when no Direct account is connected", async () => {
    const { store } = fakeStore(null);
    expect(await source(store)("b1")).toBeNull();
  });

  it("does not refresh a token that lives on", async () => {
    const { store, calls } = fakeStore(row());
    let refreshed = 0;
    const tokens = await source(store, () => {
      refreshed += 1;
      return Promise.resolve({ accessToken: "new", refreshToken: null, expiresAt: null });
    })("b1");
    expect(tokens).toBe("old");
    expect(refreshed).toBe(0);
    expect(calls.replace).toBe(0);
  });

  it("refreshes a token that is about to expire and stores the new pair", async () => {
    const { store, current } = fakeStore(row({ tokenExpiresAt: new Date(now.getTime() + DAY) }));
    const tokens = await source(store)("b1");
    expect(tokens).toBe("new");
    expect(current()).toEqual({
      accessTokenEnc: "enc:new",
      refreshTokenEnc: "enc:refresh-2",
      tokenExpiresAt: new Date(now.getTime() + 365 * DAY),
    });
  });

  it("keeps the old refresh token when Yandex returns none", async () => {
    const { store, current } = fakeStore(row({ tokenExpiresAt: new Date(now.getTime() - DAY) }));
    await source(store, () => Promise.resolve({ accessToken: "new", refreshToken: null, expiresAt: null }))("b1");
    expect(current()).toEqual({ accessTokenEnc: "enc:new", refreshTokenEnc: "enc:refresh", tokenExpiresAt: null });
  });

  it("returns the current token when there is nothing to refresh with", async () => {
    const { store, calls } = fakeStore(row({ refreshTokenEnc: null, tokenExpiresAt: new Date(now.getTime() - DAY) }));
    expect(await source(store)("b1")).toBe("old");
    expect(calls.replace).toBe(0);
  });

  it("uses the token another job stored when its own compare-and-set loses", async () => {
    const initial = row({ tokenExpiresAt: new Date(now.getTime() + DAY) });
    let current: DirectTokenRow = initial;
    const store: DirectTokenStore = {
      read: () => Promise.resolve(current),
      replace: () => {
        // A parallel job refreshed first and won the write.
        current = { accessTokenEnc: "enc:other", refreshTokenEnc: "enc:other-refresh", tokenExpiresAt: new Date(now.getTime() + 365 * DAY) };
        return Promise.resolve(false);
      },
    };
    expect(await source(store)("b1")).toBe("other");
  });

  it("fails loudly when Yandex rejects the refresh", async () => {
    const { store, current } = fakeStore(row({ tokenExpiresAt: new Date(now.getTime() + DAY) }));
    const before = current();
    await expect(
      source(store, () => Promise.reject(new Error("invalid_grant")))("b1"),
    ).rejects.toThrow("invalid_grant");
    expect(current()).toEqual(before);
  });
});
