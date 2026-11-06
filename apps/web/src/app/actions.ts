"use server";

import { signIn, signOut } from "@/auth";
import { DEMO_LOGIN_PROVIDER } from "@/lib/account-mode";

/** «Демо-режим»: a new demo account at once, without forms (auth spec «Демо-вход»). */
export async function signInAsDemo(): Promise<void> {
  await signIn(DEMO_LOGIN_PROVIDER, { redirectTo: "/" });
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
