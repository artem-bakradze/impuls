import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { TestModeBanner } from "@/components/TestModeBanner";
import { isTestMode, webConfig } from "@/lib/server/config";
import { findBusiness } from "@/lib/server/business";
import { requireUserId } from "@/lib/server/session";
import { userKind } from "@/lib/server/users";
import { signOutAction } from "../actions";

export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const userId = await requireUserId();
  const business = await findBusiness(userId);
  const simulated = Boolean(business?.launchedOn && business.mode === "simulation");
  return (
    <>
      {/* In a simulation the pult says the ads are not real; one such mark on the screen, not two. */}
      {!simulated && isTestMode(webConfig()) ? <TestModeBanner /> : null}
      <AppHeader launched={Boolean(business?.launchedOn)} demo={(await userKind(userId)) === "demo"} signOutAction={signOutAction} />
      <main className={business?.launchedOn ? "workspace" : undefined}>{children}</main>
    </>
  );
}
