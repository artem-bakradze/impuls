"use server";

import { signIn, signOut, TEST_LOGIN_PROVIDER } from "@/auth";
import { webConfig } from "@/lib/server/config";

export async function signInWithGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/" });
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
