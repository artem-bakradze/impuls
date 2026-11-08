import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { findBusiness } from "@/lib/server/business";
import { requireUserId } from "@/lib/server/session";
import { userKind } from "@/lib/server/users";
import { signOutAction } from "../actions";

export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const userId = await requireUserId();
  const business = await findBusiness(userId);
  return (
    <>
      <AppHeader launched={Boolean(business?.launchedOn)} demo={(await userKind(userId)) === "demo"} signOutAction={signOutAction} />
      <main className={business?.launchedOn ? "workspace" : undefined}>{children}</main>
    </>
  );
}
