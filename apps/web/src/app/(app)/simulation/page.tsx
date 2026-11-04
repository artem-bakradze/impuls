import { redirect } from "next/navigation";

/**
 * The simulation lives on «Реклама» now (simulation-mode spec «Симуляция как отдельный режим»): the old address opens it,
 * and `?week=N` stays a history link.
 */
export default async function SimulationPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const { week } = await searchParams;
  redirect(typeof week === "string" && /^\d+$/.test(week) ? `/summary?week=${week}` : "/summary");
}
