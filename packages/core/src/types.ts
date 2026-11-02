import type { CsoSource } from "./cso";

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
  /** Object the user reverted an action for. */
  objectId: string;
  commandType: CommandType;
  on: LocalDate;
}

/** Devices a bid adjustment can be set for (add-agent-analyst-stage1 design decision 4). */
export type AdjustableDevice = "mobile" | "desktop";

export type Command =
  | { type: "SetSpendLimit"; directionId: string; weeklyLimit: Kopecks }
  | { type: "SetStrategy"; directionId: string; strategyId: string }
  | { type: "PauseAd"; adId: string; replacementAdId?: string; dueToModeration?: boolean }
  | { type: "ResumeAd"; adId: string }
  | { type: "PauseDirection"; directionId: string }
  | { type: "ResumeDirection"; directionId: string; weeklyLimit?: Kopecks }
  | { type: "PauseAll" }
  | { type: "ResumeAll" }
  /**
   * A/B test of one ad: the variant is added as a second ad of the same group (ab-testing spec). The worker fills
   * `variant` and `hypothesis` from ad-creatives before execution; a command without a variant is rejected.
   */
  | { type: "StartExperiment"; directionId: string; adId: string; kind: HypothesisKind; hypothesis: string; variant?: { title: string; text: string } }
  | { type: "FinishExperiment"; experimentId: string; directionId: string; keepAdId: string; pauseAdId: string }
  | { type: "UpdateSchedule"; directionId: string; schedule: string }
  /** City the campaign is shown in (business-onboarding spec: city instead of a radius). */
  | { type: "UpdateGeo"; directionId: string; city: string }
  | { type: "UpdateAdText"; adId: string; title: string; text: string }
  /** Negative phrases of a direction (add-agent-analyst-stage1): added to or removed from its whole list. */
  | { type: "AddNegativeKeywords"; directionId: string; phrases: string[] }
  | { type: "RemoveNegativeKeywords"; directionId: string; phrases: string[] }
  /** Bid adjustment of a direction in percent: for phones, or for computers (tablets follow computers in Direct). */
  | { type: "SetDeviceAdjustment"; directionId: string; device: AdjustableDevice; percent: number }
  /** The owner's cost-per-lead goal: own amount or automatic selection (campaign-settings spec). */
  | { type: "SetGoal"; source: CsoSource }
  /** What the business sells, as the owner corrected it after launch (campaign-settings spec); ads are not rewritten. */
  | { type: "UpdateCard"; card: CardPatch }
  /** Mini-site card as JSON (the card type lives in @impuls/minisite). */
  | { type: "UpdateMiniSite"; card: string }
  | { type: "PublishMiniSite" };

/** Editable part of the business card: the facts new ad variants are written from. */
export interface CardPatch {
  category: string;
  services: { name: string; priceRub: number | null }[];
  advantages: string[];
}

/** What a single-change ad variant changes (ad-creatives spec). */
export type HypothesisKind = "offer" | "title" | "benefit";

export type CommandType = Command["type"];

export const emptyStats = (): PerformanceStats => ({ impressions: 0, clicks: 0, leads: 0, spend: 0 });

export const costPerLead = (stats: PerformanceStats): Kopecks | null =>
  stats.leads === 0 ? null : Math.round(stats.spend / stats.leads);

export const rubles = (value: number): Kopecks => Math.round(value * 100);
