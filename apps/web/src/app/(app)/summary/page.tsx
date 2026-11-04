import { SummaryView } from "@/components/summary/SummaryView";
import { loadAdsWork } from "@/lib/server/simulation-screen";
import { buildSimulationStatus } from "@/lib/server/simulation";
import { buildSummary } from "@/lib/server/summary";
import { requireLaunchedBusiness } from "@/lib/server/session";

/**
 * «Реклама» (analytics spec): the month's numbers, the ads, the journal and the service's review. A simulation adds its
 * player here, on the same screen (simulation-mode spec «Симуляция как отдельный режим»). `?week=N` opens the journal on
 * that week.
 */
export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const { business } = await requireLaunchedBusiness();
  const { week } = await searchParams;
  const [model, work, simulation] = await Promise.all([
    buildSummary(business.id, "month"),
    loadAdsWork(business.id),
    business.mode === "simulation" ? buildSimulationStatus(business.id) : Promise.resolve(null),
  ]);
  return <SummaryView model={model} work={work} simulation={simulation} focusWeek={typeof week === "string" && /^\d+$/.test(week) ? Number(week) : null} />;
}
