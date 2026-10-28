/** Money is stored as integer kopecks to avoid floating point drift. */
export type Kopecks = number;

/** Calendar date in the business time zone, formatted as YYYY-MM-DD. */
export type LocalDate = string;

export type Channel = "search" | "network";
export type ObjectStatus = "active" | "paused";

export interface Direction {
  id: string;
  businessId: string;
  name: string;
  channel: Channel;
  status: ObjectStatus;
  weeklyLimit: Kopecks;
  strategyId: string;
  createdOn: LocalDate;
  lastLimitIncreaseOn: LocalDate | null;
  lastStrategyChangeOn: LocalDate | null;
}

export interface Ad {
  id: string;
  directionId: string;
  status: ObjectStatus;
  title: string;
  text: string;
  createdOn: LocalDate;
}

export interface PerformanceStats {
  impressions: number;
  clicks: number;
  leads: number;
  spend: Kopecks;
}

export type EffectivenessClass = "learning" | "ineffective" | "effective" | "borderline";

export type Actor = "agent" | "safety_net" | "budget_guard" | "user" | "reconciliation";

export interface UserDecision {
  /** Object the user reverted or declined an action for. */
  objectId: string;
  commandType: CommandType;
  on: LocalDate;
}

export type Command =
  | { type: "SetSpendLimit"; directionId: string; weeklyLimit: Kopecks }
  | { type: "SetStrategy"; directionId: string; strategyId: string }
  | { type: "PauseAd"; adId: string; replacementAdId?: string; dueToModeration?: boolean }
  | { type: "ResumeAd"; adId: string }
  | { type: "PauseDirection"; directionId: string }
  | { type: "ResumeDirection"; directionId: string; weeklyLimit?: Kopecks }
  | { type: "PauseAll" }
  | { type: "ResumeAll" }
  | { type: "StartExperiment"; directionId: string; adId: string; hypothesis: string; variantAdId?: string }
  | { type: "FinishExperiment"; experimentId: string; directionId: string; keepAdId: string; pauseAdId: string }
  | { type: "UpdateSchedule"; directionId: string; schedule: string }
  | { type: "UpdateGeo"; directionId: string; radiusKm: number }
  | { type: "UpdateAdText"; adId: string; title: string; text: string }
  /** Mini-site card as JSON (the card type lives in @impuls/minisite). */
  | { type: "UpdateMiniSite"; card: string }
  | { type: "PublishMiniSite" };

export type CommandType = Command["type"];

export const emptyStats = (): PerformanceStats => ({ impressions: 0, clicks: 0, leads: 0, spend: 0 });

export const costPerLead = (stats: PerformanceStats): Kopecks | null =>
  stats.leads === 0 ? null : Math.round(stats.spend / stats.leads);

export const rubles = (value: number): Kopecks => Math.round(value * 100);
