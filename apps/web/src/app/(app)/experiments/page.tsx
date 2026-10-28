import { ExperimentsView } from "@/components/experiments/ExperimentsView";
import { buildExperiments } from "@/lib/server/experiments";
import { requireLaunchedBusiness } from "@/lib/server/session";

export default async function ExperimentsPage() {
  const { business } = await requireLaunchedBusiness();
  return <ExperimentsView model={await buildExperiments(business.id)} />;
}
