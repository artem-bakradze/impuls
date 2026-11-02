import { HistoryView } from "@/components/history/HistoryView";
import { buildHistory } from "@/lib/server/history";
import { requireLaunchedBusiness } from "@/lib/server/session";

export default async function HistoryPage() {
  const { business } = await requireLaunchedBusiness();
  const { items, names } = await buildHistory(business.id);
  return <HistoryView items={items} names={names} timeZone={business.timeZone} monthlyBudgetRub={business.monthlyBudgetRub} />;
}
