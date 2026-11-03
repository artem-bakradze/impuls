import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { SimulationBar } from "@/components/SimulationBar";
import { TestModeBanner } from "@/components/TestModeBanner";
import { isTestMode, webConfig } from "@/lib/server/config";
import { findBusiness } from "@/lib/server/business";
import { requireUserId } from "@/lib/server/session";
import { buildSimulationStatus } from "@/lib/server/simulation";
import { signOutAction } from "../actions";

export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const userId = await requireUserId();
  const business = await findBusiness(userId);
  const simulation = business?.launchedOn && business.mode === "simulation" ? await buildSimulationStatus(business.id) : null;
  return (
    <>
      {/* In a simulation the pult says the ads are not real; one such mark on the screen, not two. */}
      {simulation === null && isTestMode(webConfig()) ? <TestModeBanner /> : null}
      <AppHeader launched={Boolean(business?.launchedOn)} simulated={simulation !== null} signOutAction={signOutAction} />
      {simulation ? <SimulationBar initial={simulation} /> : null}
      <main className={business?.launchedOn ? "workspace" : undefined}>{children}</main>
    </>
  );
}
