import { notFound } from "next/navigation";
import { TurnView } from "@/components/history/TurnView";
import type { TurnViewModel } from "@/components/history/TurnView";
import { store } from "@/lib/server/runtime";
import { requireLaunchedBusiness } from "@/lib/server/session";

export default async function TurnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business } = await requireLaunchedBusiness();
  // Only the signed-in owner's turns are read, so a turn of another business is «не найден».
  const turn = (await store().turns(business.id)).find((t) => t.id === id);
  if (!turn) {
    notFound();
  }
  const model: TurnViewModel = {
    trigger: turn.trigger,
    runtime: turn.runtime,
    instructionsVersion: turn.instructionsVersion,
    status: turn.status,
    startedAt: turn.startedAt.toISOString(),
    context: turn.context,
    calls: turn.calls as TurnViewModel["calls"],
  };
  return <TurnView turn={model} timeZone={business.timeZone} />;
}
