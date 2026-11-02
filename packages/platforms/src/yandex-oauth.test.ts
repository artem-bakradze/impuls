import { describe, expect, it } from "vitest";
import { refreshYandexToken, YandexTokenRefreshError } from "./yandex-oauth";

const client = { clientId: "cid", clientSecret: "secret" };
const now = new Date("2026-11-02T10:00:00Z");

const respond = (body: unknown, status = 200) => (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;

describe("refreshYandexToken", () => {
  it("sends the refresh grant and returns the new token set", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = ((url: string, init: RequestInit) => {
      calls.push({ url, body: typeof init.body === "string" ? init.body : "" });
      return Promise.resolve(new Response(JSON.stringify({ access_token: "new", refresh_token: "r2", expires_in: 3600 }), { status: 200 }));
    }) as unknown as typeof fetch;

    const tokens = await refreshYandexToken(fetchImpl, client, "r1", now);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://oauth.yandex.ru/token");
    const body = new URLSearchParams(calls[0]?.body);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "r1",
      client_id: "cid",
      client_secret: "secret",
    });
    expect(tokens).toEqual({
      accessToken: "new",
      refreshToken: "r2",
      expiresAt: new Date("2026-11-02T11:00:00Z"),
    });
  });

  it("keeps no refresh token when Yandex does not return a new one", async () => {
    const tokens = await refreshYandexToken(respond({ access_token: "new" }), client, "r1", now);
    expect(tokens).toEqual({ accessToken: "new", refreshToken: null, expiresAt: null });
  });

  it("fails explicitly on a rejected refresh instead of returning the old token", async () => {
    await expect(refreshYandexToken(respond({ error: "invalid_grant" }, 400), client, "r1", now)).rejects.toBeInstanceOf(YandexTokenRefreshError);
  });

  it("fails explicitly on a response without an access token", async () => {
    await expect(refreshYandexToken(respond({ refresh_token: "r2" }), client, "r1", now)).rejects.toBeInstanceOf(YandexTokenRefreshError);
  });
});
