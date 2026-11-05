"use server";

import { signIn, signOut } from "@/auth";
import { DEMO_LOGIN_PROVIDER, TEST_LOGIN_PROVIDER } from "@/lib/account-mode";
import { webConfig } from "@/lib/server/config";

/** «Демо-режим»: a new demo account at once, without forms (auth spec «Демо-вход»). */
export async function signInAsDemo(): Promise<void> {
  await signIn(DEMO_LOGIN_PROVIDER, { redirectTo: "/" });
}

/** e2e-only login; refused unless AUTH_TEST_LOGIN=enabled. */
export async function signInForTests(formData: FormData): Promise<void> {
  if (webConfig().AUTH_TEST_LOGIN !== "enabled") {
    throw new Error("Test login is disabled");
  }
  await signIn(TEST_LOGIN_PROVIDER, { email: formData.get("email"), name: formData.get("name"), redirectTo: "/" });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
