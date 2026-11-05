import type {
  Actor,
  Ad,
  Command,
  CsoSource,
  Direction,
  EffectivenessClass,
  InsightDraft,
  InsightMetric,
  InsightPeriod,
  Kopecks,
  LocalDate,
  UserDecision,
} from "@impuls/core";
import type { DailyStatRow, DeviceAdjustments, SimulatorState } from "@impuls/platforms";
import type { LaunchPlan } from "./launch";

export type BusinessMode = "direct" | "simulation";

/** `stepping`: a period goes (or, in old runs, a day or a week); otherwise the simulation's time stands (simulation-mode spec). */
export type SimulationStatus = "paused" | "stepping";

/** Result of the control run «если бы сервис ничего не делал» over the same period. */
export interface SimulationBaseline {
  days: number;
  spend: Kopecks;
  leads: number;
  /** Spend and leads of each day of the control run, from the first day, for the comparison by day. */
  daily: { spend: Kopecks; leads: number }[];
}

/**
 * One step of the player: a period of the owner's stats (simulation-mode spec «Статистика периода от владельца»), or
 * «Прожить неделю» and «+1 день» of runs saved before it.
 */
export interface SimulationStep {
  kind: "week" | "day" | "period";
  from: Date;
  to: Date;
  /** A period's length, the numbers the owner entered and whether they are in the market already. */
  days?: number | undefined;
  input?: { adId: string; impressions: number; clicks: number; leads: number; spendRub: number }[] | undefined;
  recorded?: boolean | undefined;
  /** Absent only for runs saved before explicit step completion existed. */
  state?: "pending" | "running" | "completed" | "failed" | undefined;
  completedAt?: Date | undefined;
  errorCode?: string | undefined;
  /** Versioned JSON snapshot; dates are restored by readWeekReport. */
  report?: string | undefined;
}

/** A recorded agent turn of the run being repeated, with the virtual time it started at. */
export interface ReplayTurn {
  at: Date;
  trigger: string;
  summary: string;
  calls: { command: Command | null; insight: InsightDraft; accepted: boolean }[];
  /** Hypothesis journal writes of the turn (ad-agent «Журнал гипотез»), as the agent sent them. */
  hypotheses: unknown[];
}

/** An owner action of the run being repeated: the same at the same virtual hour keeps the repeat exact. */
export interface ReplayOwnerAction {
  at: Date;
  type: string;
  objectId: string;
}

/** «Повторить этот прогон» (simulation-mode spec «Повтор прогона»). */
export interface SimulationReplay {
  turns: ReplayTurn[];
  ownerActions: ReplayOwnerAction[];
  /**
   * The run's ids of directions and ads by their simulated platform ids, which repeat in every run of the scenario:
   * the recorded calls are carried over to the new run's objects by them.
   */
  ids: Record<string, string>;
  /** Turns already replayed. */
  position: number;
  /** The owner or the guards took the run elsewhere: the agent decides on the model from here. */
  diverged: boolean;
  /** The pult has said so once. */
  notified: boolean;
}

/** Virtual time and saved market of a business in the simulation mode. */
export interface SimulationRecord {
  businessId: string;
  /** The market scenario of a run started before the owner entered the stats; null for every run since. */
  scenario: string | null;
  seed: number;
  plan: LaunchPlan;
  startedAt: Date;
  simNow: Date;
  endsAt: Date;
  /** Unused since the time moves only by steps (weekly-simulation-triggered-agent); kept as stored. */
  lastTickAt: Date | null;
  /** Unused since the time moves only by steps (weekly-simulation-triggered-agent); kept as stored. */
  speed: number;
  status: SimulationStatus;
  state: SimulatorState;
  baseline: SimulationBaseline | null;
  steps: SimulationStep[];
  replay: SimulationReplay | null;
}

export interface BusinessRecord {
  id: string;
  userId: string;
  timeZone: string;
  monthlyBudgetRub: number;
  launchedOn: LocalDate | null;
  csoSource: CsoSource;
  /** Mini-site for businesses without their own site; `card` is MiniSiteCard JSON. */
  miniSite: { slug: string; card: string; metrikaCounterId: number; advertiser: { name: string; inn: string } } | null;
  /** Metrica goal that counts leads; null until analytics is connected. Lead-paying strategies need it. */
  leadGoalId: string | null;
  /** «Яндекс Директ» or «Симуляция» (add-simulation-mode); a simulated business never reaches the Direct API. */
  mode: BusinessMode;
  /**
   * Public business card. The agent snapshot copies only allowlisted fields from it; `city` and `siteUrl` are used
   * by the worker for new ads and campaigns.
   */
  card: {
    category: string;
    services: { name: string; priceRub: number | null }[];
    area: string;
    hours: string;
    advantages: string[];
    /** Business name and address: card facts for new ad variants, not passed to the agent. */
    name: string;
    address: string;
    /** City the ads are shown in. */
    city: string;
    /** The owner's site every ad leads to. */
    siteUrl: string;
    /** Latest code-presence check, not proof of goal delivery. */
    measurement?: { siteUrl: string; status: "found" | "not_found" | "unreachable"; counterId: number | null };
  };
}

export interface DirectionRecord extends Direction {
  platformCampaignId: string;
  pausedByBudget: boolean;
  /** Paused by the owner («Поставить рекламу на паузу») — never resumed automatically. */
  pausedByUser: boolean;
  schedule: string;
  city: string;
  /** Key phrases of the launch plan (empty for directions launched before add-agent-analyst-stage1). */
  keywords: string[];
  /** Campaign-level negative phrases and bid adjustments as last applied or reconciled. */
  negativeKeywords: string[];
  deviceAdjustments: DeviceAdjustments;
  deviceAdjustedOn: { mobile: LocalDate | null; desktop: LocalDate | null };
}

/** Settings of a new direction before the analyst levers touch it. */
export const NO_TRAFFIC_SETTINGS: Pick<DirectionRecord, "negativeKeywords" | "deviceAdjustments" | "deviceAdjustedOn"> = {
  negativeKeywords: [],
  deviceAdjustments: { mobile: 0, desktop: 0 },
  deviceAdjustedOn: { mobile: null, desktop: null },
};

export interface AdRecord extends Ad {
  platformAdId: string;
  moderation: "accepted" | "pending" | "rejected";
}

export type Snapshot = Record<string, string | number | boolean | null>;
export type ChangeAuthor = "service" | "user" | "cabinet";
export type ChangeStatus = "pending" | "applied" | "failed";

export type LoggedAction = Command | { type: "ExternalChange" };

export interface ChangeEntry {
  id: string;
  businessId: string;
  actor: Actor;
  author: ChangeAuthor;
  action: LoggedAction;
  objectKind: "direction" | "ad" | "business" | "minisite" | "goal" | "card";
  objectId: string;
  before: Snapshot;
  after: Snapshot;
  status: ChangeStatus;
  reasonCode: string;
  explanation: string;
  turnId: string | null;
  /** The insight that explains this decision (insights spec); set right after the change is executed. */
  insightId?: string | null;
  createdAt: Date;
  error: string | null;
  revertedById: string | null;
  /** «Что стало после», filled 7 days after an automated change. */
  outcome: string | null;
}

/** A fact of an insight as it was at the time: what, about which object, for which period, how much. */
export interface InsightFactRecord {
  key: string;
  object: string;
  metric: InsightMetric;
  period: InsightPeriod;
  value: number;
  unit: "rub" | "count";
}

/**
 * Insight (insights spec): what the service noticed, on which facts, what it decided — the action and the guard's
 * answer, or why nothing changes — and what comes next.
 */
export interface InsightRecord {
  id: string;
  businessId: string;
  turnId: string | null;
  source: "agent" | "rule";
  reasonCode: string;
  observation: string;
  facts: InsightFactRecord[];
  decision: { kind: "action" | "none"; text: string; status: "applied" | "clamped" | "rejected" | "none"; changeIds: string[] };
  next: string;
  /** The ad or direction the insight is about, for «На самом деле» in a simulation. */
  objectRef: { kind: "ad" | "direction"; id: string } | null;
  createdAt: Date;
}

export type HypothesisStatus = "checking" | "confirmed" | "rejected" | "dropped";

/** One entry of the agent's hypothesis journal (ad-agent spec «Журнал гипотез»). */
export interface HypothesisRecord {
  id: string;
  businessId: string;
  openedTurnId: string | null;
  closedTurnId: string | null;
  /** What is checked, in plain words. */
  statement: string;
  facts: InsightFactRecord[];
  /** How and by which day it is checked. */
  check: string;
  checkOn: LocalDate;
  status: HypothesisStatus;
  /** What came out, on the facts of the closing turn. */
  result: string | null;
  resultFacts: InsightFactRecord[];
  openedAt: Date;
  closedAt: Date | null;
}

export interface Evaluation {
  businessId: string;
  evaluatedAt: Date;
  on: LocalDate;
  adClasses: Map<string, EffectivenessClass>;
  directionClasses: Map<string, EffectivenessClass>;
  borderlineSince: Map<string, LocalDate>;
  /** Keys of the findings of this evaluation (ad-agent «Поводы для хода агента»). */
  findings: string[];
}

export interface Experiment {
  id: string;
  businessId: string;
  directionId: string;
  adId: string;
  variantAdId: string | null;
  hypothesis: string;
  startedOn: LocalDate;
  status: "running" | "finished";
  outcome: string | null;
}

export interface AgentTurnRecord {
  id: string;
  businessId: string;
  trigger: string;
  runtime: string;
  instructionsVersion: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: "running" | "completed" | "failed" | "cancelled";
  context: unknown;
  calls: unknown[];
  summary: string | null;
  /** The summary passed the checks and is shown as «Разбор дня» (insights spec). */
  summaryValid: boolean;
  /** Token usage and its source; null for a turn without a model (test policies). */
  inputTokens: number | null;
  outputTokens: number | null;
  usageSource: "api" | "estimate" | null;
  costKopecks: number;
}

/** What the insight feed needs of a turn: when, how it ended and its day review (insights spec «Разбор дня»). */
export type TurnDigest = Pick<AgentTurnRecord, "id" | "trigger" | "status" | "startedAt" | "summary" | "summaryValid" | "usageSource">;

/** An event waiting for the next agent turn; several events are merged into one turn. */
export interface InboxEvent {
  id: string;
  businessId: string;
  trigger: { kind: string; adIds?: string[]; experimentIds?: string[] };
  createdAt: Date;
  consumedByTurnId: string | null;
}

/** Weekly answer «сколько обращений стали клиентами». */
export interface ClientConfirmation {
  businessId: string;
  weekStart: LocalDate;
  clients: number;
  leads: number;
}

export type FlagName = "agent_enabled" | "automation_enabled";
export type IncidentKind = "budget_overrun" | "agent_unavailable" | "stuck_command" | "stats_mismatch" | "heartbeat_stale";

export interface Incident {
  id: string;
  kind: IncidentKind;
  businessId: string | null;
  message: string;
  openedAt: Date;
}

export interface Notification {
  businessId: string;
  kind: string;
  message: string;
  at: Date;
}

export interface StoredNotification extends Notification {
  id: string;
  sentAt: Date | null;
}

/** Persistence port used by the executor and jobs. Implemented in memory (tests, simulation) and in PostgreSQL. */
export interface Store {
  getBusiness(id: string): Promise<BusinessRecord>;
  listBusinesses(): Promise<BusinessRecord[]>;
  saveBusiness(business: BusinessRecord): Promise<void>;
  directions(businessId: string): Promise<DirectionRecord[]>;
  saveDirection(direction: DirectionRecord): Promise<void>;
  ads(businessId: string): Promise<AdRecord[]>;
  saveAd(ad: AdRecord): Promise<void>;
  appendChange(entry: Omit<ChangeEntry, "id">): Promise<ChangeEntry>;
  updateChange(id: string, patch: Partial<Pick<ChangeEntry, "status" | "after" | "error" | "revertedById" | "outcome" | "insightId">>): Promise<void>;
  saveInsight(insight: InsightRecord): Promise<void>;
  /** Insights of a business, oldest first. */
  insights(businessId: string): Promise<InsightRecord[]>;
  /** The hypothesis journal of a business, oldest first. */
  hypotheses(businessId: string): Promise<HypothesisRecord[]>;
  saveHypothesis(hypothesis: HypothesisRecord): Promise<void>;
  changes(businessId: string): Promise<ChangeEntry[]>;
  pendingChanges(): Promise<ChangeEntry[]>;
  upsertStats(businessId: string, rows: readonly DailyStatRow[]): Promise<void>;
  stats(businessId: string, from: LocalDate, to: LocalDate): Promise<DailyStatRow[]>;
  userDecisions(businessId: string): Promise<UserDecision[]>;
  addUserDecision(businessId: string, decision: UserDecision): Promise<void>;
  getCursor(businessId: string, name: string): Promise<Date | null>;
  setCursor(businessId: string, name: string, at: Date): Promise<void>;
  saveEvaluation(evaluation: Evaluation): Promise<void>;
  lastEvaluation(businessId: string): Promise<Evaluation | null>;
  experiments(businessId: string): Promise<Experiment[]>;
  saveExperiment(experiment: Experiment): Promise<void>;
  saveTurn(turn: AgentTurnRecord): Promise<void>;
  turns(businessId: string): Promise<AgentTurnRecord[]>;
  /** The turns without their context and calls, oldest first. */
  turnDigests(businessId: string): Promise<TurnDigest[]>;
  /** The business's running agent turn — when it started and what for — for the pult; null when no turn runs. */
  runningTurn(businessId: string): Promise<{ startedAt: Date; trigger: string } | null>;
  /** Agent journal retention: deletes turns started before `before`; returns how many. */
  purgeTurns(before: Date): Promise<number>;
  addInboxEvent(event: Omit<InboxEvent, "id" | "consumedByTurnId">): Promise<void>;
  pendingInbox(businessId: string): Promise<InboxEvent[]>;
  consumeInbox(ids: readonly string[], turnId: string): Promise<void>;
  saveClientConfirmation(confirmation: ClientConfirmation): Promise<void>;
  clientConfirmations(businessId: string): Promise<ClientConfirmation[]>;
  /** Flags are enabled unless explicitly switched off (documented default). Per-business values override global. */
  getFlag(name: FlagName, businessId: string | null): Promise<boolean>;
  setFlag(name: FlagName, value: boolean, businessId: string | null): Promise<void>;
  beat(name: string, at: Date): Promise<void>;
  lastBeat(name: string): Promise<Date | null>;
  openIncident(incident: Omit<Incident, "id">): Promise<void>;
  incidents(): Promise<Incident[]>;
  notify(notification: Notification): Promise<void>;
  notifications(businessId: string): Promise<Notification[]>;
  unsentNotifications(): Promise<StoredNotification[]>;
  markNotificationSent(id: string, at: Date): Promise<void>;
  /** Owner's email for notifications; the only place personal data leaves the store. */
  ownerEmail(businessId: string): Promise<string>;
  /** Account deletion (auth spec): revoke stored OAuth tokens and mark the owner deleted. */
  revokePlatformAccount(businessId: string, at: Date): Promise<void>;
  markOwnerDeleted(businessId: string, at: Date): Promise<void>;
  /** Anonymizes owners deleted before `before`; returns how many were purged. */
  purgeDeletedOwners(before: Date): Promise<number>;
  getSimulation(businessId: string): Promise<SimulationRecord | null>;
  saveSimulation(simulation: SimulationRecord): Promise<void>;
  deleteSimulation(businessId: string): Promise<void>;
  /** Simulations whose virtual time moves: running or going to the next decision. */
  /**
   * Everything the launch created for a business — campaigns, ads, stats, history, experiments, evaluations,
   * client answers, notifications, agent journal, hypotheses and cursors; the business row and its card stay.
   */
  deleteLaunchData(businessId: string): Promise<void>;
  /**
   * «Запустить по-настоящему»: the business is not launched any more, works with Direct and opens the wizard on
   * `step` with its draft kept, Direct not connected yet.
   */
  reopenWizard(businessId: string, step: number): Promise<void>;
}

export class MemoryStore implements Store {
  private readonly businessMap = new Map<string, BusinessRecord>();
  private readonly directionMap = new Map<string, DirectionRecord>();
  private readonly adMap = new Map<string, AdRecord>();
  private readonly changeLog: ChangeEntry[] = [];
  private readonly statRows = new Map<string, DailyStatRow & { businessId: string }>();
  private readonly decisions = new Map<string, UserDecision[]>();
  private readonly cursors = new Map<string, Date>();
  private readonly evaluations = new Map<string, Evaluation>();
  private readonly experimentMap = new Map<string, Experiment>();
  private readonly turnList: AgentTurnRecord[] = [];
  private readonly insightList: InsightRecord[] = [];
  private readonly hypothesisList: HypothesisRecord[] = [];
  private readonly inbox: InboxEvent[] = [];
  private readonly confirmations = new Map<string, ClientConfirmation>();
  private readonly flags = new Map<string, boolean>();
  private readonly beats = new Map<string, Date>();
  private readonly incidentList: Incident[] = [];
  private readonly notificationList: StoredNotification[] = [];
  readonly emails = new Map<string, string>();
  readonly revokedAccounts = new Map<string, Date>();
  readonly deletedOwners = new Map<string, Date>();
  private readonly simulationMap = new Map<string, SimulationRecord>();
  private seq = 1;

  getBusiness(id: string): Promise<BusinessRecord> {
    const business = this.businessMap.get(id);
    if (!business) {
      return Promise.reject(new Error(`Business ${id} not found`));
    }
    return Promise.resolve(structuredClone(business));
  }
  listBusinesses(): Promise<BusinessRecord[]> {
    return Promise.resolve([...this.businessMap.values()].map((b) => structuredClone(b)));
  }
  saveBusiness(business: BusinessRecord): Promise<void> {
    this.businessMap.set(business.id, structuredClone(business));
    return Promise.resolve();
  }
  directions(businessId: string): Promise<DirectionRecord[]> {
    return Promise.resolve([...this.directionMap.values()].filter((d) => d.businessId === businessId).map((d) => structuredClone(d)));
  }
  saveDirection(direction: DirectionRecord): Promise<void> {
    this.directionMap.set(direction.id, structuredClone(direction));
    return Promise.resolve();
  }
  async ads(businessId: string): Promise<AdRecord[]> {
    const directionIds = new Set((await this.directions(businessId)).map((d) => d.id));
    return [...this.adMap.values()].filter((a) => directionIds.has(a.directionId)).map((a) => ({ ...a }));
  }
  saveAd(ad: AdRecord): Promise<void> {
    this.adMap.set(ad.id, { ...ad });
    return Promise.resolve();
  }
  appendChange(entry: Omit<ChangeEntry, "id">): Promise<ChangeEntry> {
    const stored: ChangeEntry = { ...structuredClone(entry), id: `chg-${this.seq++}` };
    this.changeLog.push(stored);
    return Promise.resolve(structuredClone(stored));
  }
  saveInsight(insight: InsightRecord): Promise<void> {
    const index = this.insightList.findIndex((i) => i.id === insight.id);
    if (index >= 0) this.insightList[index] = structuredClone(insight);
    else this.insightList.push(structuredClone(insight));
    return Promise.resolve();
  }
  insights(businessId: string): Promise<InsightRecord[]> {
    return Promise.resolve(
      this.insightList
        .filter((i) => i.businessId === businessId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((i) => structuredClone(i)),
    );
  }
  hypotheses(businessId: string): Promise<HypothesisRecord[]> {
    return Promise.resolve(
      this.hypothesisList
        .filter((h) => h.businessId === businessId)
        .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())
        .map((h) => structuredClone(h)),
    );
  }
  saveHypothesis(hypothesis: HypothesisRecord): Promise<void> {
    const index = this.hypothesisList.findIndex((h) => h.id === hypothesis.id);
    if (index >= 0) this.hypothesisList[index] = structuredClone(hypothesis);
    else this.hypothesisList.push(structuredClone(hypothesis));
    return Promise.resolve();
  }
  updateChange(id: string, patch: Partial<Pick<ChangeEntry, "status" | "after" | "error" | "revertedById" | "outcome" | "insightId">>): Promise<void> {
    const entry = this.changeLog.find((c) => c.id === id);
    if (!entry) {
      return Promise.reject(new Error(`Change ${id} not found`));
    }
    Object.assign(entry, structuredClone(patch));
    return Promise.resolve();
  }
  changes(businessId: string): Promise<ChangeEntry[]> {
    return Promise.resolve(this.changeLog.filter((c) => c.businessId === businessId).map((c) => structuredClone(c)));
  }
  pendingChanges(): Promise<ChangeEntry[]> {
    return Promise.resolve(this.changeLog.filter((c) => c.status === "pending").map((c) => structuredClone(c)));
  }
  upsertStats(businessId: string, rows: readonly DailyStatRow[]): Promise<void> {
    for (const row of rows) {
      this.statRows.set(`${businessId}|${row.date}|${row.adId}`, { ...row, businessId });
    }
    return Promise.resolve();
  }
  stats(businessId: string, from: LocalDate, to: LocalDate): Promise<DailyStatRow[]> {
    return Promise.resolve(
      [...this.statRows.values()]
        .filter((r) => r.businessId === businessId && r.date >= from && r.date <= to)
        .map((r) => ({ date: r.date, campaignId: r.campaignId, adId: r.adId, impressions: r.impressions, clicks: r.clicks, leads: r.leads, spend: r.spend })),
    );
  }
  userDecisions(businessId: string): Promise<UserDecision[]> {
    return Promise.resolve([...(this.decisions.get(businessId) ?? [])]);
  }
  addUserDecision(businessId: string, decision: UserDecision): Promise<void> {
    this.decisions.set(businessId, [...(this.decisions.get(businessId) ?? []), decision]);
    return Promise.resolve();
  }
  getCursor(businessId: string, name: string): Promise<Date | null> {
    return Promise.resolve(this.cursors.get(`${businessId}|${name}`) ?? null);
  }
  setCursor(businessId: string, name: string, at: Date): Promise<void> {
    this.cursors.set(`${businessId}|${name}`, at);
    return Promise.resolve();
  }
  saveEvaluation(evaluation: Evaluation): Promise<void> {
    this.evaluations.set(evaluation.businessId, structuredClone(evaluation));
    return Promise.resolve();
  }
  lastEvaluation(businessId: string): Promise<Evaluation | null> {
    const evaluation = this.evaluations.get(businessId);
    return Promise.resolve(evaluation ? structuredClone(evaluation) : null);
  }
  experiments(businessId: string): Promise<Experiment[]> {
    return Promise.resolve([...this.experimentMap.values()].filter((e) => e.businessId === businessId).map((e) => ({ ...e })));
  }
  saveExperiment(experiment: Experiment): Promise<void> {
    this.experimentMap.set(experiment.id, { ...experiment });
    return Promise.resolve();
  }
  saveTurn(turn: AgentTurnRecord): Promise<void> {
    const index = this.turnList.findIndex((t) => t.id === turn.id);
    if (index >= 0) {
      this.turnList[index] = structuredClone(turn);
    } else {
      this.turnList.push(structuredClone(turn));
    }
    return Promise.resolve();
  }
  purgeTurns(before: Date): Promise<number> {
    const keep = this.turnList.filter((t) => t.startedAt >= before);
    const removed = this.turnList.length - keep.length;
    this.turnList.splice(0, this.turnList.length, ...keep);
    return Promise.resolve(removed);
  }
  turns(businessId: string): Promise<AgentTurnRecord[]> {
    return Promise.resolve(this.turnList.filter((t) => t.businessId === businessId).map((t) => structuredClone(t)));
  }
  turnDigests(businessId: string): Promise<TurnDigest[]> {
    return Promise.resolve(
      this.turnList
        .filter((t) => t.businessId === businessId)
        .map((t) => ({ id: t.id, trigger: t.trigger, status: t.status, startedAt: new Date(t.startedAt.getTime()), summary: t.summary, summaryValid: t.summaryValid, usageSource: t.usageSource })),
    );
  }
  runningTurn(businessId: string): Promise<{ startedAt: Date; trigger: string } | null> {
    const running = this.turnList.filter((t) => t.businessId === businessId && t.status === "running").at(-1);
    return Promise.resolve(running ? { startedAt: new Date(running.startedAt.getTime()), trigger: running.trigger } : null);
  }
  addInboxEvent(event: Omit<InboxEvent, "id" | "consumedByTurnId">): Promise<void> {
    this.inbox.push({ ...structuredClone(event), id: `inbox-${this.seq++}`, consumedByTurnId: null });
    return Promise.resolve();
  }
  pendingInbox(businessId: string): Promise<InboxEvent[]> {
    return Promise.resolve(this.inbox.filter((e) => e.businessId === businessId && e.consumedByTurnId === null).map((e) => structuredClone(e)));
  }
  consumeInbox(ids: readonly string[], turnId: string): Promise<void> {
    for (const event of this.inbox) {
      if (ids.includes(event.id)) {
        event.consumedByTurnId = turnId;
      }
    }
    return Promise.resolve();
  }
  saveClientConfirmation(c: ClientConfirmation): Promise<void> {
    this.confirmations.set(`${c.businessId}|${c.weekStart}`, { ...c });
    return Promise.resolve();
  }
  clientConfirmations(businessId: string): Promise<ClientConfirmation[]> {
    return Promise.resolve([...this.confirmations.values()].filter((c) => c.businessId === businessId).map((c) => ({ ...c })));
  }
  getFlag(name: FlagName, businessId: string | null): Promise<boolean> {
    const global = this.flags.get(`${name}|*`) ?? true;
    if (!global) {
      return Promise.resolve(false);
    }
    return Promise.resolve(businessId === null ? true : (this.flags.get(`${name}|${businessId}`) ?? true));
  }
  setFlag(name: FlagName, value: boolean, businessId: string | null): Promise<void> {
    this.flags.set(`${name}|${businessId ?? "*"}`, value);
    return Promise.resolve();
  }
  beat(name: string, at: Date): Promise<void> {
    this.beats.set(name, at);
    return Promise.resolve();
  }
  lastBeat(name: string): Promise<Date | null> {
    return Promise.resolve(this.beats.get(name) ?? null);
  }
  openIncident(incident: Omit<Incident, "id">): Promise<void> {
    this.incidentList.push({ ...incident, id: `inc-${this.seq++}` });
    return Promise.resolve();
  }
  incidents(): Promise<Incident[]> {
    return Promise.resolve([...this.incidentList]);
  }
  notify(notification: Notification): Promise<void> {
    this.notificationList.push({ ...notification, id: `ntf-${this.seq++}`, sentAt: null });
    return Promise.resolve();
  }
  unsentNotifications(): Promise<StoredNotification[]> {
    return Promise.resolve(this.notificationList.filter((n) => n.sentAt === null).map((n) => ({ ...n })));
  }
  markNotificationSent(id: string, at: Date): Promise<void> {
    const n = this.notificationList.find((x) => x.id === id);
    if (n) {
      n.sentAt = at;
    }
    return Promise.resolve();
  }
  revokePlatformAccount(businessId: string, at: Date): Promise<void> {
    this.revokedAccounts.set(businessId, at);
    return Promise.resolve();
  }
  markOwnerDeleted(businessId: string, at: Date): Promise<void> {
    this.deletedOwners.set(businessId, at);
    return Promise.resolve();
  }
  getSimulation(businessId: string): Promise<SimulationRecord | null> {
    const simulation = this.simulationMap.get(businessId);
    return Promise.resolve(simulation ? structuredClone(simulation) : null);
  }
  saveSimulation(simulation: SimulationRecord): Promise<void> {
    this.simulationMap.set(simulation.businessId, structuredClone(simulation));
    return Promise.resolve();
  }
  deleteSimulation(businessId: string): Promise<void> {
    this.simulationMap.delete(businessId);
    return Promise.resolve();
  }
  reopenWizard(businessId: string): Promise<void> {
    const business = this.businessMap.get(businessId);
    if (business) {
      this.businessMap.set(businessId, { ...business, launchedOn: null, mode: "direct" });
    }
    return Promise.resolve();
  }
  deleteLaunchData(businessId: string): Promise<void> {
    const directionIds = new Set([...this.directionMap.values()].filter((d) => d.businessId === businessId).map((d) => d.id));
    const dropWhere = <V>(map: Map<string, V>, matches: (key: string, value: V) => boolean) => {
      for (const [key, value] of [...map]) if (matches(key, value)) map.delete(key);
    };
    const keepOthers = <V extends { businessId: string }>(list: V[]) => list.splice(0, list.length, ...list.filter((v) => v.businessId !== businessId));
    dropWhere(this.adMap, (_, ad) => directionIds.has(ad.directionId));
    dropWhere(this.directionMap, (id) => directionIds.has(id));
    dropWhere(this.statRows, (_, row) => row.businessId === businessId);
    dropWhere(this.experimentMap, (_, e) => e.businessId === businessId);
    dropWhere(this.cursors, (key) => key.startsWith(`${businessId}|`));
    dropWhere(this.confirmations, (key) => key.startsWith(`${businessId}|`));
    this.evaluations.delete(businessId);
    this.decisions.delete(businessId);
    keepOthers(this.changeLog);
    keepOthers(this.turnList);
    keepOthers(this.insightList);
    keepOthers(this.hypothesisList);
    keepOthers(this.inbox);
    keepOthers(this.notificationList);
    return Promise.resolve();
  }
  purgeDeletedOwners(before: Date): Promise<number> {
    let purged = 0;
    for (const [businessId, at] of this.deletedOwners) {
      if (at < before && this.emails.has(businessId)) {
        this.emails.delete(businessId);
        purged++;
      }
    }
    return Promise.resolve(purged);
  }
  ownerEmail(businessId: string): Promise<string> {
    const email = this.emails.get(businessId);
    return email ? Promise.resolve(email) : Promise.reject(new Error(`No owner email for ${businessId}`));
  }
  notifications(businessId: string): Promise<Notification[]> {
    return Promise.resolve(this.notificationList.filter((n) => n.businessId === businessId).map(({ businessId: b, kind, message, at }) => ({ businessId: b, kind, message, at })));
  }
}
