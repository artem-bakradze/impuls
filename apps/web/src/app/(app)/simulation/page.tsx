import { redirect } from "next/navigation";
import { SimulationStudio } from "@/components/simulation/SimulationStudio";
import { loadAdsWork } from "@/lib/server/simulation-screen";
import { buildSimulationStatus } from "@/lib/server/simulation";
import { buildSummary } from "@/lib/server/summary";
import { requireLaunchedBusiness } from "@/lib/server/session";

/** The simulation's control room (simulation-mode spec «Симуляция как отдельный режим»). `?week=N` stays a history link. */
export default async function SimulationPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const { week } = await searchParams;
  if (typeof week === "string" && /^\d+$/.test(week)) redirect(`/summary?week=${week}`);
  const { business } = await requireLaunchedBusiness();
  if (business.mode !== "simulation") redirect("/summary");
  const [model, work, status] = await Promise.all([buildSummary(business.id, "month"), loadAdsWork(business.id), buildSimulationStatus(business.id)]);
  if (status === null) redirect("/summary");
  return <SimulationStudio model={model} work={work} initial={status} />;
}
