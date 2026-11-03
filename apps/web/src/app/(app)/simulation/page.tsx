import { redirect } from "next/navigation";

/** The decisions screen is part of «Реклама» now (simulation-mode spec); `?week=N` keeps pointing at that lived week. */
export default async function SimulationPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const { week } = await searchParams;
  redirect(typeof week === "string" && /^\d+$/.test(week) ? `/summary?week=${week}` : "/summary");
}
