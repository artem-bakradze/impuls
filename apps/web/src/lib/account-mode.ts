/** How the account signed in (auth spec «Демо-вход»); `test` is the e2e-only login and works like Google. */
export type AccountKind = "google" | "test" | "demo";

export type AccountMode = "direct" | "simulation";

/** «Демо-режим»: a sign-in without forms, Google or email (auth spec «Демо-вход»). */
export const DEMO_LOGIN_PROVIDER = "demo";
/** The e2e-only email login, on with AUTH_TEST_LOGIN=enabled. */
export const TEST_LOGIN_PROVIDER = "test-login";

/** The account a sign-in creates; `subject` is the provider's id for it, stored as `users.google_sub`. */
export interface NewAccount {
  subject: string;
  kind: AccountKind;
  email: string | null;
  name: string | null;
}

/**
 * Maps a sign-in to its account. A demo has no email or name, so no personal data is kept; the test login needs its
 * email. Google is off for now (auth spec «Вход через Google пока недоступен»): any other provider is refused.
 */
export const accountFromSignIn = (provider: string, user: { id?: string | undefined; email?: string | null | undefined; name?: string | null | undefined }): NewAccount => {
  if (provider === DEMO_LOGIN_PROVIDER) {
    if (!user.id) {
      throw new Error("Demo sign-in returned no id");
    }
    return { subject: `demo:${user.id}`, kind: "demo", email: null, name: null };
  }
  if (provider === TEST_LOGIN_PROVIDER) {
    if (!user.email) {
      throw new Error("Identity provider returned no email");
    }
    return { subject: `test:${user.email}`, kind: "test", email: user.email, name: user.name ?? null };
  }
  throw new Error(`Sign-in through ${provider} is not available`);
};

/**
 * The business mode follows the login (simulation-mode spec «Режим бизнеса «Симуляция»»): a demo is only a simulation,
 * an account that signed in with Google or the test login is only Direct. The wizard has no choice of its own.
 */
export const accountMode = (kind: AccountKind): AccountMode => (kind === "demo" ? "simulation" : "direct");

export const WIZARD_OUTDATED_MESSAGE = "Мастер обновился — обновите страницу";

export type LaunchModeCheck = { ok: true; mode: AccountMode } | { ok: false; code: "WIZARD_OUTDATED"; message: string };

/**
 * The mode of a launch request. A page from before demo-login sent `simulation: true` for its «Симуляция» choice and
 * nothing for Direct; today's page sends nothing. A request asking for another mode than the account's is refused
 * rather than launched in the account's mode: a stale page with «Симуляция» chosen must never start real ads.
 */
export const launchModeFor = (kind: AccountKind, request: { simulation?: boolean | undefined }): LaunchModeCheck => {
  const mode = accountMode(kind);
  if (request.simulation === undefined) {
    return { ok: true, mode };
  }
  const asked: AccountMode = request.simulation ? "simulation" : "direct";
  return asked === mode ? { ok: true, mode } : { ok: false, code: "WIZARD_OUTDATED", message: WIZARD_OUTDATED_MESSAGE };
};
