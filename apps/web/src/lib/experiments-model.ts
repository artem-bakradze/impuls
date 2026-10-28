export interface ExperimentVariant {
  title: string;
  clicks: number;
  leads: number;
  spend: number;
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
  maxActive: number;
  running: ExperimentItem[];
  finished: ExperimentItem[];
}

/** Progress towards a verdict: both the minimum duration and enough visitors on each variant. */
export const experimentProgress = (item: ExperimentItem, model: Pick<ExperimentsModel, "minDays" | "maxDays" | "minClicks">): number => {
  const byDays = Math.min(1, item.day / model.minDays);
  const clicks = Math.min(item.control.clicks, item.variant?.clicks ?? item.control.clicks);
  const byClicks = Math.min(1, clicks / model.minClicks);
  const byDeadline = Math.min(1, item.day / model.maxDays);
  return Math.round(Math.max(Math.min(byDays, byClicks), byDeadline) * 100);
};
