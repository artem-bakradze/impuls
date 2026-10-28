import { SummaryView } from "@/components/summary/SummaryView";
import { buildSummary } from "@/lib/server/summary";
import { requireLaunchedBusiness } from "@/lib/server/session";

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const { business } = await requireLaunchedBusiness();
  const { period } = await searchParams;
  const model = await buildSummary(business.id, period === "month" ? "month" : "week");
  return <SummaryView model={model} />;
}
