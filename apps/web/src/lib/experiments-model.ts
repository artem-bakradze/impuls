export interface ExperimentVariant {
  title: string;
  /** The ad text: variants often differ only in it, under the same title. */
  text: string;
  clicks: number;
  leads: number;
  spend: number;
  /** False when the agent or a rule paused this side during the check: it brought no clients. */
  active: boolean;
}

export interface ExperimentItem {
  id: string;
  hypothesis: string;
  direction: string;
  startedOn: string;
  day: number;
  status: "running" | "finished";
  outcome: string | null;
  control: ExperimentVariant;
  variant: ExperimentVariant | null;
}

export interface ExperimentsModel {
  minDays: number;
  maxDays: number;
  minClicks: number;
  running: ExperimentItem[];
  finished: ExperimentItem[];
}

/** Whether the check has the minimum duration and enough visitors on each variant to be decided. */
export const experimentReady = (item: ExperimentItem, model: Pick<ExperimentsModel, "minDays" | "minClicks">): boolean =>
  item.day >= model.minDays && Math.min(item.control.clicks, item.variant?.clicks ?? item.control.clicks) >= model.minClicks;

/**
 * Progress towards a verdict: the minimum duration and enough visitors on each variant, then the deadline. A running
 * check never shows a full bar: with enough data it waits for a reliable difference, at most until the deadline.
 */
export const experimentProgress = (item: ExperimentItem, model: Pick<ExperimentsModel, "minDays" | "maxDays" | "minClicks">): number => {
  const byDays = Math.min(1, item.day / model.minDays);
  const clicks = Math.min(item.control.clicks, item.variant?.clicks ?? item.control.clicks);
  const byClicks = Math.min(1, clicks / model.minClicks);
  const byDeadline = Math.min(1, item.day / model.maxDays);
  const percent = Math.round(Math.max(Math.min(byDays, byClicks), byDeadline) * 100);
  return item.status === "running" ? Math.min(95, percent) : percent;
};
