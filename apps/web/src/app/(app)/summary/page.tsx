import { SummaryView } from "@/components/summary/SummaryView";
import { loadAdsWork } from "@/lib/server/simulation-screen";
import { buildSummary } from "@/lib/server/summary";
import { requireLaunchedBusiness } from "@/lib/server/session";

/** «Реклама» (analytics spec): the month's numbers, the ads and the journal. `?week=N` scrolls the journal to that week. */
export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const { business } = await requireLaunchedBusiness();
  const { week } = await searchParams;
  const [model, work] = await Promise.all([buildSummary(business.id, "month"), loadAdsWork(business.id)]);
  return <SummaryView model={model} work={work} focusWeek={typeof week === "string" && /^\d+$/.test(week) ? Number(week) : null} />;
}
