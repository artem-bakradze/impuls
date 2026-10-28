import type {
  Actor,
  Ad,
  Command,
  CsoSource,
  Direction,
  EffectivenessClass,
  LocalDate,
  UserDecision,
} from "@impuls/core";
import type { DailyStatRow } from "@impuls/platforms";

export interface BusinessRecord {
  id: string;
  userId: string;
  timeZone: string;
  monthlyBudgetRub: number;
  launchedOn: LocalDate | null;
  csoSource: CsoSource;
  autonomy: "auto" | "ask";
  /** Public business card fields passed to the agent (allowlist). */
  card: { category: string; services: { name: string; priceRub: number | null }[]; area: string; hours: string; advantages: string[] };
}

export interface DirectionRecord extends Direction {
  platformCampaignId: string;
  pausedByBudget: boolean;
}

export interface AdRecord extends Ad {
  platformAdId: string;
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
  objectKind: "direction" | "ad" | "business";
  objectId: string;
  before: Snapshot;
  after: Snapshot;
  status: ChangeStatus;
  reasonCode: string;
  explanation: string;
  turnId: string | null;
  createdAt: Date;
  error: string | null;
}

export interface Evaluation {
  businessId: string;
  evaluatedAt: Date;
  on: LocalDate;
  adClasses: Map<string, EffectivenessClass>;
  directionClasses: Map<string, EffectivenessClass>;
  borderlineSince: Map<string, LocalDate>;
}

export interface Experiment {
  id: string;
  businessId: string;
  directionId: string;
  adId: string;
  hypothesis: string;
  startedOn: LocalDate;
  status: "running" | "finished";
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
  updateChange(id: string, patch: Partial<Pick<ChangeEntry, "status" | "after" | "error">>): Promise<void>;
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
  notes(businessId: string): Promise<string[]>;
  saveNotes(businessId: string, notes: readonly string[]): Promise<void>;
  /** Flags are enabled unless explicitly switched off (documented default). Per-business values override global. */
  getFlag(name: FlagName, businessId: string | null): Promise<boolean>;
  setFlag(name: FlagName, value: boolean, businessId: string | null): Promise<void>;
  beat(name: string, at: Date): Promise<void>;
  lastBeat(name: string): Promise<Date | null>;
  openIncident(incident: Omit<Incident, "id">): Promise<void>;
  incidents(): Promise<Incident[]>;
  notify(notification: Notification): Promise<void>;
  notifications(businessId: string): Promise<Notification[]>;
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
  private readonly noteMap = new Map<string, string[]>();
  private readonly flags = new Map<string, boolean>();
  private readonly beats = new Map<string, Date>();
  private readonly incidentList: Incident[] = [];
  private readonly notificationList: Notification[] = [];
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
    return Promise.resolve([...this.directionMap.values()].filter((d) => d.businessId === businessId).map((d) => ({ ...d })));
  }
  saveDirection(direction: DirectionRecord): Promise<void> {
    this.directionMap.set(direction.id, { ...direction });
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
  updateChange(id: string, patch: Partial<Pick<ChangeEntry, "status" | "after" | "error">>): Promise<void> {
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
  turns(businessId: string): Promise<AgentTurnRecord[]> {
    return Promise.resolve(this.turnList.filter((t) => t.businessId === businessId).map((t) => structuredClone(t)));
  }
  notes(businessId: string): Promise<string[]> {
    return Promise.resolve([...(this.noteMap.get(businessId) ?? [])]);
  }
  saveNotes(businessId: string, notes: readonly string[]): Promise<void> {
    this.noteMap.set(businessId, [...notes]);
    return Promise.resolve();
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
    this.notificationList.push(notification);
    return Promise.resolve();
  }
  notifications(businessId: string): Promise<Notification[]> {
    return Promise.resolve(this.notificationList.filter((n) => n.businessId === businessId));
  }
}
