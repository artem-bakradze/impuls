import "server-only";
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { accountFromSignIn, DEMO_LOGIN_PROVIDER, TEST_LOGIN_PROVIDER } from "@/lib/account-mode";
import { webConfig } from "@/lib/server/config";
import { upsertUser } from "@/lib/server/users";

declare module "next-auth" {
  interface Session {
    userId?: string;
  }
}

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 3600;

const TestLogin = z.object({ email: z.email(), name: z.string().min(1).max(100) });

/**
 * Sign-in (auth spec): «Демо-режим» creates a new account without email or name; Google is not connected at all while
 * its login is unavailable, so a direct request to it finds no provider. Sessions are signed JWT cookies valid for 30
 * days since the last activity (refreshed daily). Cookies are HttpOnly and SameSite=Lax; Secure in production builds.
 * The email-only test login exists only when AUTH_TEST_LOGIN=enabled (e2e), never by default; the start page has no form
 * for it, e2e posts to /api/auth/callback/test-login.
 */
export const { handlers, auth, signIn, signOut } = NextAuth((): NextAuthConfig => {
  const config = webConfig();
  const testLogin = config.AUTH_TEST_LOGIN === "enabled";
  const providers: NextAuthConfig["providers"] = [
    Credentials({
      id: DEMO_LOGIN_PROVIDER,
      name: "Демо-режим",
      credentials: {},
      // Every press without a session is a new demo: nothing identifies a visitor but this browser's session.
      authorize: () => ({ id: crypto.randomUUID() }),
    }),
  ];
  if (testLogin) {
    providers.push(
      Credentials({
        id: TEST_LOGIN_PROVIDER,
        name: "Тестовый вход",
        credentials: { email: { type: "email" }, name: { type: "text" } },
        authorize: (raw) => {
          const parsed = TestLogin.safeParse(raw);
          return parsed.success ? { id: `test:${parsed.data.email}`, email: parsed.data.email, name: parsed.data.name } : null;
        },
      }),
    );
  }
  return {
    secret: config.AUTH_SECRET,
    providers,
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: 24 * 3600 },
    pages: { signIn: "/", error: "/" },
    // Over plain HTTP (local e2e against a production build) Secure cookies would never be sent back.
    useSecureCookies: process.env.NODE_ENV === "production" && !testLogin,
    callbacks: {
      async jwt({ token, account, user }) {
        if (account) {
          token.userId = await upsertUser(accountFromSignIn(account.provider, user));
        }
        return token;
      },
      session({ session, token }) {
        if (typeof token.userId === "string") {
          session.userId = token.userId;
        }
        return session;
      },
    },
  };
});
