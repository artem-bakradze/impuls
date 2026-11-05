import { redirect } from "next/navigation";
import { Wizard } from "@/components/wizard/Wizard";
import { accountMode } from "@/lib/account-mode";
import { firstIncompleteStep, STEP_COUNT, wizardStepOf } from "@/lib/onboarding";
import { findBusiness, readDraft } from "@/lib/server/business";
import { webConfig } from "@/lib/server/config";
import { requireUserId } from "@/lib/server/session";
import { userKind } from "@/lib/server/users";

export default async function WizardPage({ searchParams }: { searchParams: Promise<{ direct?: string }> }) {
  const { direct } = await searchParams;
  const userId = await requireUserId();
  const business = await findBusiness(userId);
  if (business?.launchedOn) {
    redirect("/summary");
  }
  const draft = readDraft(business);
  const saved = Math.min(wizardStepOf(business?.onboardingStep ?? 1, draft), STEP_COUNT);
  return (
    <Wizard
      initialDraft={draft}
      initialStep={Math.min(saved, firstIncompleteStep(draft))}
      directApiMode={webConfig().DIRECT_API_MODE}
      mode={accountMode(await userKind(userId))}
      directOutcome={direct === "connected" || direct === "denied" || direct === "failed" ? direct : null}
    />
  );
}
