import { describe, expect, it } from "vitest";
import { exchangeCodeWithYandex, finishAuthorization, startAuthorization, TokenExchangeError } from "./direct-oauth";
import type { DirectOAuthDeps, TokenSet } from "./direct-oauth";

const config = { clientId: "cid", clientSecret: "secret", appUrl: "https://app.example" };

const fakeDeps = () => {
  let now = new Date("2026-10-29T10:00:00Z");
  const states = new Map<string, { userId: string; expiresAt: Date }>();
  const saved: { userId: string; tokens: TokenSet }[] = [];
  const exchanged: string[] = [];
  let n = 0;
  const deps: DirectOAuthDeps = {
    now: () => now,
    randomState: () => `state-${++n}`,
    saveState: (entry) => {
      states.set(entry.state, entry);
      return Promise.resolve();
    },
    consumeState: (state, userId, at) => {
      const entry = states.get(state);
      states.delete(state);
      return Promise.resolve(entry !== undefined && entry.userId === userId && entry.expiresAt > at);
    },
    exchangeCode: (code) => {
      exchanged.push(code);
      return Promise.resolve({ accessToken: "y0_token", refreshToken: "r", expiresAt: null });
    },
    saveAccount: (userId, tokens) => {
      saved.push({ userId, tokens });
      return Promise.resolve();
    },
  };
  return { deps, saved, exchanged, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
};

const callback = (query: Record<string, string>) => new URLSearchParams(query);

describe("Direct OAuth", () => {
  it("sends the owner to Yandex with a one-time state and the service callback", async () => {
    const { deps } = fakeDeps();
    const url = new URL(await startAuthorization(deps, config, "u1"));
    expect(url.origin + url.pathname).toBe("https://oauth.yandex.ru/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: "https://app.example/api/direct/oauth/callback",
      state: "state-1",
      force_confirm: "yes",
    });
  });

  it("connects the account once for a valid state", async () => {
    const { deps, saved } = fakeDeps();
    await startAuthorization(deps, config, "u1");
    expect(await finishAuthorization(deps, callback({ state: "state-1", code: "c1" }), "u1")).toBe("connected");
    expect(saved).toEqual([{ userId: "u1", tokens: { accessToken: "y0_token", refreshToken: "r", expiresAt: null } }]);
    // Replaying the same answer is refused.
    expect(await finishAuthorization(deps, callback({ state: "state-1", code: "c1" }), "u1")).toBe("failed");
    expect(saved).toHaveLength(1);
  });

  it("Пользователь отказался от доступа: nothing is stored", async () => {
    const { deps, saved, exchanged } = fakeDeps();
    await startAuthorization(deps, config, "u1");
    expect(await finishAuthorization(deps, callback({ state: "state-1", error: "access_denied" }), "u1")).toBe("denied");
    expect(saved).toEqual([]);
    expect(exchanged).toEqual([]);
  });

  it("Подложный ответ авторизации: unknown, foreign or expired state never reaches the code exchange", async () => {
    const { deps, saved, exchanged, advance } = fakeDeps();
    await startAuthorization(deps, config, "u1");
    expect(await finishAuthorization(deps, callback({ state: "forged", code: "c" }), "u1")).toBe("failed");
    expect(await finishAuthorization(deps, callback({ state: "state-1", code: "c" }), "u2")).toBe("failed");
    await startAuthorization(deps, config, "u1");
    advance(10 * 60 * 1_000 + 1);
    expect(await finishAuthorization(deps, callback({ state: "state-2", code: "c" }), "u1")).toBe("failed");
    expect(await finishAuthorization(deps, callback({ code: "c" }), "u1")).toBe("failed");
    expect(exchanged).toEqual([]);
    expect(saved).toEqual([]);
  });

  it("exchanges the code for tokens", async () => {
    const requests: { url: string; body: string }[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      requests.push({ url: input instanceof Request ? input.url : String(input), body: typeof init?.body === "string" ? init.body : "" });
      return Promise.resolve(new Response(JSON.stringify({ access_token: "y0_a", refresh_token: "r_b", expires_in: 3600 })));
    };
    const tokens = await exchangeCodeWithYandex(fetchImpl, config, "code-1", new Date("2026-10-29T10:00:00Z"));
    expect(tokens).toEqual({ accessToken: "y0_a", refreshToken: "r_b", expiresAt: new Date("2026-10-29T11:00:00Z") });
    expect(requests[0]?.url).toBe("https://oauth.yandex.ru/token");
    expect(Object.fromEntries(new URLSearchParams(requests[0]?.body))).toEqual({ grant_type: "authorization_code", code: "code-1", client_id: "cid", client_secret: "secret" });
  });

  it("fails explicitly when Yandex refuses the code", async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    await expect(exchangeCodeWithYandex(fetchImpl, config, "bad", new Date())).rejects.toBeInstanceOf(TokenExchangeError);
  });
});
