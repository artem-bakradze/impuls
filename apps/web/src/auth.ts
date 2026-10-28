import "server-only";
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { webConfig } from "@/lib/server/config";
import { upsertUser } from "@/lib/server/users";

declare module "next-auth" {
  interface Session {
    userId?: string;
  }
}

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 3600;
export const TEST_LOGIN_PROVIDER = "test-login";

const TestLogin = z.object({ email: z.email(), name: z.string().min(1).max(100) });

/**
 * Google sign-in (auth spec). Sessions are signed JWT cookies valid for 30 days since the last activity
 * (refreshed daily). Cookies are HttpOnly and SameSite=Lax; Secure in production builds.
 * The email-only test login exists only when AUTH_TEST_LOGIN=enabled (e2e), never by default.
 */
export const { handlers, auth, signIn, signOut } = NextAuth((): NextAuthConfig => {
  const config = webConfig();
  const testLogin = config.AUTH_TEST_LOGIN === "enabled";
  const providers: NextAuthConfig["providers"] = [Google({ clientId: config.AUTH_GOOGLE_ID, clientSecret: config.AUTH_GOOGLE_SECRET })];
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
          const email = user.email;
          if (!email) {
            throw new Error("Identity provider returned no email");
          }
          const subject = account.provider === "google" ? `google:${account.providerAccountId}` : `test:${email}`;
          token.userId = await upsertUser({ subject, email, name: user.name ?? null });
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
