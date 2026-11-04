import { redirect } from "next/navigation";

/** The history is the journal of «Реклама» now (change-history spec); old links land there with the sheet open. */
export default function HistoryPage() {
  redirect("/summary#history");
}
