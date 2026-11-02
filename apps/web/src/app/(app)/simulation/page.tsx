import { redirect } from "next/navigation";
import { DecisionsView } from "@/components/simulation/DecisionsView";
import { loadDecisionScreen } from "@/lib/server/simulation-screen";
import { requireLaunchedBusiness } from "@/lib/server/session";

/**
 * Only a simulated business has this screen; a business on Direct goes to the summary (simulation-mode spec). `?week=N`
 * opens the story of that lived week, otherwise the newest one.
 */
export default async function SimulationPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const { business } = await requireLaunchedBusiness();
  const { week } = await searchParams;
  const number = typeof week === "string" && /^\d+$/.test(week) ? Number(week) : null;
  const model = business.mode === "simulation" ? await loadDecisionScreen(business.id, number) : null;
  if (model === null) {
    redirect("/summary");
  }
  return <DecisionsView model={model} />;
}
