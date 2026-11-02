import { redirect } from "next/navigation";
import { DecisionsView } from "@/components/simulation/DecisionsView";
import { loadDecisionScreen } from "@/lib/server/simulation-screen";
import { requireLaunchedBusiness } from "@/lib/server/session";

/** Only a simulated business has this screen; a business on Direct goes to the summary (simulation-mode spec). */
export default async function SimulationPage() {
  const { business } = await requireLaunchedBusiness();
  const model = business.mode === "simulation" ? await loadDecisionScreen(business.id) : null;
  if (model === null) {
    redirect("/summary");
  }
  return <DecisionsView model={model} />;
}
