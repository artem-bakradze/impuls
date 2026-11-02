import { redirect } from "next/navigation";
import { Wizard } from "@/components/wizard/Wizard";
import { firstIncompleteStep, STEP_COUNT } from "@/lib/onboarding";
import { findBusiness, readDraft } from "@/lib/server/business";
import { webConfig } from "@/lib/server/config";
import { requireUserId } from "@/lib/server/session";

export default async function WizardPage({ searchParams }: { searchParams: Promise<{ direct?: string }> }) {
  const { direct } = await searchParams;
  const userId = await requireUserId();
  const business = await findBusiness(userId);
  if (business?.launchedOn) {
    redirect("/summary");
  }
  const draft = readDraft(business);
  const saved = Math.min(Math.max(business?.onboardingStep ?? 1, 1), STEP_COUNT);
  return (
    <Wizard
      initialDraft={draft}
      initialStep={Math.min(saved, firstIncompleteStep(draft))}
      directApiMode={webConfig().DIRECT_API_MODE}
      directOutcome={direct === "connected" || direct === "denied" || direct === "failed" ? direct : null}
    />
  );
}
