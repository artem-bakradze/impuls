import { randomUUID } from "node:crypto";
import { schema } from "@impuls/db";
import type { Db } from "@impuls/db";
import type { CsoSource, EffectivenessClass, LocalDate, UserDecision } from "@impuls/core";
import type { DailyStatRow } from "@impuls/platforms";
import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from "@impuls/db";
import type {
  AdRecord,
  AgentTurnRecord,
  ApprovalRequest,
  ClientConfirmation,
  InboxEvent,
  BusinessRecord,
  ChangeEntry,
  DirectionRecord,
  Evaluation,
  Experiment,
  FlagName,
  Incident,
  Notification,
  Snapshot,
  StoredNotification,
  Store,
} from "./store";

const GLOBAL = "*";
const toMap = <V>(value: unknown): Map<string, V> => new Map(Object.entries(value as Record<string, V>));
const fromMap = <V>(map: ReadonlyMap<string, V>): Record<string, V> => Object.fromEntries(map);

/** PostgreSQL implementation of the persistence port. Every call autocommits, so `pending` survives crashes. */
export class PgStore implements Store {
  constructor(private readonly db: Db) {}

  async getBusiness(id: string): Promise<BusinessRecord> {
    const [row] = await this.db.select().from(schema.businesses).where(eq(schema.businesses.id, id));
    if (!row) {
      throw new Error(`Business ${id} not found`);
    }
    return this.toBusiness(row);
  }

  private toBusiness(row: typeof schema.businesses.$inferSelect): BusinessRecord {
    const csoSource: CsoSource = row.csoMode === "user" ? { kind: "user", goal: row.csoValue } : { kind: "auto", reference: row.csoValue };
    return {
      id: row.id,
      userId: row.userId,
      timeZone: row.timeZone,
      monthlyBudgetRub: row.monthlyBudgetRub,
      launchedOn: row.launchedOn,
      csoSource,
      autonomy: row.autonomy,
      card: row.card as BusinessRecord["card"],
      miniSite: (row.miniSite as BusinessRecord["miniSite"]) ?? null,
      leadGoalId: row.leadGoalId,
      weeklySummaryEnabled: row.weeklySummaryEnabled,
    };
  }

  async listBusinesses(): Promise<BusinessRecord[]> {
    return (await this.db.select().from(schema.businesses).orderBy(asc(schema.businesses.id))).map((r) => this.toBusiness(r));
  }

  async saveBusiness(b: BusinessRecord): Promise<void> {
    const values = {
      id: b.id,
      userId: b.userId,
      timeZone: b.timeZone,
      monthlyBudgetRub: b.monthlyBudgetRub,
      launchedOn: b.launchedOn,
      csoMode: b.csoSource.kind,
      csoValue: b.csoSource.kind === "user" ? b.csoSource.goal : b.csoSource.reference,
      autonomy: b.autonomy,
      card: b.card,
      miniSite: b.miniSite,
      leadGoalId: b.leadGoalId,
      weeklySummaryEnabled: b.weeklySummaryEnabled,
    };
    await this.db.insert(schema.businesses).values(values).onConflictDoUpdate({ target: schema.businesses.id, set: values });
  }

  async directions(businessId: string): Promise<DirectionRecord[]> {
    const rows = await this.db.select().from(schema.campaigns).where(eq(schema.campaigns.businessId, businessId)).orderBy(asc(schema.campaigns.id));
    return rows.map((r) => ({
      id: r.id,
      businessId: r.businessId,
      name: r.name,
      channel: r.channel,
      status: r.status,
      weeklyLimit: r.weeklyLimit,
      strategyId: r.strategyId,
      createdOn: r.createdOn,
      lastLimitIncreaseOn: r.lastLimitIncreaseOn,
      lastStrategyChangeOn: r.lastStrategyChangeOn,
      platformCampaignId: r.platformCampaignId,
      pausedByBudget: r.pausedByBudget,
      pausedByUser: r.pausedByUser,
      schedule: r.schedule,
      geoRadiusKm: r.geoRadiusKm,
    }));
  }

  async saveDirection(d: DirectionRecord): Promise<void> {
    const values = { ...d };
    await this.db.insert(schema.campaigns).values(values).onConflictDoUpdate({ target: schema.campaigns.id, set: values });
  }

  async ads(businessId: string): Promise<AdRecord[]> {
    const rows = await this.db
      .select({ ad: schema.ads })
      .from(schema.ads)
      .innerJoin(schema.campaigns, eq(schema.ads.campaignId, schema.campaigns.id))
      .where(eq(schema.campaigns.businessId, businessId))
      .orderBy(asc(schema.ads.id));
    return rows.map(({ ad }) => ({
      id: ad.id,
      directionId: ad.campaignId,
      status: ad.status,
      title: ad.title,
      text: ad.text,
      createdOn: ad.createdOn,
      platformAdId: ad.platformAdId,
      moderation: ad.moderation,
    }));
  }

  async saveAd(a: AdRecord): Promise<void> {
    const values = {
      id: a.id,
      campaignId: a.directionId,
      platformAdId: a.platformAdId,
      status: a.status,
      title: a.title,
      text: a.text,
      moderation: a.moderation,
      createdOn: a.createdOn,
    };
    await this.db.insert(schema.ads).values(values).onConflictDoUpdate({ target: schema.ads.id, set: values });
  }

  private toChange(r: typeof schema.changeLog.$inferSelect): ChangeEntry {
    return {
      id: r.id,
      businessId: r.businessId,
      actor: r.actor,
      author: r.author,
      action: r.action as ChangeEntry["action"],
      objectKind: r.objectKind,
      objectId: r.objectId,
      before: r.before as Snapshot,
      after: r.after as Snapshot,
      status: r.status,
      reasonCode: r.reasonCode,
      explanation: r.explanation,
      turnId: r.turnId,
      createdAt: r.createdAt,
      error: r.error,
      revertedById: r.revertedById,
      outcome: r.outcome,
    };
  }

  async appendChange(entry: Omit<ChangeEntry, "id">): Promise<ChangeEntry> {
    const [row] = await this.db.insert(schema.changeLog).values({ ...entry, id: randomUUID() }).returning();
    if (!row) {
      throw new Error("Failed to append change");
    }
    return this.toChange(row);
  }

  async updateChange(id: string, patch: Partial<Pick<ChangeEntry, "status" | "after" | "error" | "revertedById" | "outcome">>): Promise<void> {
    await this.db.update(schema.changeLog).set(patch).where(eq(schema.changeLog.id, id));
  }

  async changes(businessId: string): Promise<ChangeEntry[]> {
    const rows = await this.db.select().from(schema.changeLog).where(eq(schema.changeLog.businessId, businessId)).orderBy(asc(schema.changeLog.createdAt));
    return rows.map((r) => this.toChange(r));
  }

  async pendingChanges(): Promise<ChangeEntry[]> {
    return (await this.db.select().from(schema.changeLog).where(eq(schema.changeLog.status, "pending"))).map((r) => this.toChange(r));
  }

  async upsertStats(businessId: string, rows: readonly DailyStatRow[]): Promise<void> {
    for (const r of rows) {
      const values = {
        businessId,
        date: r.date,
        platformCampaignId: r.campaignId,
        platformAdId: r.adId,
        impressions: r.impressions,
        clicks: r.clicks,
        leads: r.leads,
        costVat: r.spend,
        loadedAt: new Date(),
      };
      await this.db
        .insert(schema.statsDaily)
        .values(values)
        .onConflictDoUpdate({ target: [schema.statsDaily.businessId, schema.statsDaily.date, schema.statsDaily.platformAdId], set: values });
    }
  }

  async stats(businessId: string, from: LocalDate, to: LocalDate): Promise<DailyStatRow[]> {
    const rows = await this.db
      .select()
      .from(schema.statsDaily)
      .where(and(eq(schema.statsDaily.businessId, businessId), gte(schema.statsDaily.date, from), lte(schema.statsDaily.date, to)));
    return rows.map((r) => ({ date: r.date, campaignId: r.platformCampaignId, adId: r.platformAdId, impressions: r.impressions, clicks: r.clicks, leads: r.leads, spend: r.costVat }));
  }

  async userDecisions(businessId: string): Promise<UserDecision[]> {
    const rows = await this.db.select().from(schema.userDecisions).where(eq(schema.userDecisions.businessId, businessId));
    return rows.map((r) => ({ objectId: r.objectId, commandType: r.commandType as UserDecision["commandType"], on: r.on }));
  }

  async addUserDecision(businessId: string, d: UserDecision): Promise<void> {
    await this.db.insert(schema.userDecisions).values({ id: randomUUID(), businessId, objectId: d.objectId, commandType: d.commandType, on: d.on });
  }

  async getCursor(businessId: string, name: string): Promise<Date | null> {
    const [row] = await this.db.select().from(schema.syncCursors).where(and(eq(schema.syncCursors.businessId, businessId), eq(schema.syncCursors.name, name)));
    return row?.at ?? null;
  }

  async setCursor(businessId: string, name: string, at: Date): Promise<void> {
    await this.db
      .insert(schema.syncCursors)
      .values({ businessId, name, at })
      .onConflictDoUpdate({ target: [schema.syncCursors.businessId, schema.syncCursors.name], set: { at } });
  }

  async saveEvaluation(e: Evaluation): Promise<void> {
    const values = {
      businessId: e.businessId,
      evaluatedAt: e.evaluatedAt,
      on: e.on,
      adClasses: fromMap(e.adClasses),
      directionClasses: fromMap(e.directionClasses),
      borderlineSince: fromMap(e.borderlineSince),
    };
    await this.db.insert(schema.evaluations).values(values).onConflictDoUpdate({ target: schema.evaluations.businessId, set: values });
  }

  async lastEvaluation(businessId: string): Promise<Evaluation | null> {
    const [row] = await this.db.select().from(schema.evaluations).where(eq(schema.evaluations.businessId, businessId));
    return row
      ? {
          businessId: row.businessId,
          evaluatedAt: row.evaluatedAt,
          on: row.on,
          adClasses: toMap<EffectivenessClass>(row.adClasses),
          directionClasses: toMap<EffectivenessClass>(row.directionClasses),
          borderlineSince: toMap<LocalDate>(row.borderlineSince),
        }
      : null;
  }

  async experiments(businessId: string): Promise<Experiment[]> {
    const rows = await this.db.select().from(schema.experiments).where(eq(schema.experiments.businessId, businessId));
    return rows.map((r) => ({
      id: r.id,
      businessId: r.businessId,
      directionId: r.campaignId,
      adId: r.adId,
      variantAdId: r.variantAdId,
      hypothesis: r.hypothesis,
      startedOn: r.startedOn,
      status: r.status,
      outcome: (r.outcome as string | null) ?? null,
    }));
  }

  async saveExperiment(e: Experiment): Promise<void> {
    const values = {
      id: e.id,
      businessId: e.businessId,
      campaignId: e.directionId,
      adId: e.adId,
      variantAdId: e.variantAdId,
      hypothesis: e.hypothesis,
      startedOn: e.startedOn,
      status: e.status,
      outcome: e.outcome,
    };
    await this.db.insert(schema.experiments).values(values).onConflictDoUpdate({ target: schema.experiments.id, set: values });
  }

  async saveTurn(t: AgentTurnRecord): Promise<void> {
    const values = { ...t, context: t.context ?? {}, calls: t.calls };
    await this.db.insert(schema.agentTurns).values(values).onConflictDoUpdate({ target: schema.agentTurns.id, set: values });
  }

  async turns(businessId: string): Promise<AgentTurnRecord[]> {
    const rows = await this.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.businessId, businessId)).orderBy(asc(schema.agentTurns.startedAt));
    return rows.map((r) => ({ ...r, calls: r.calls as unknown[] }));
  }

  async purgeTurns(before: Date): Promise<number> {
    return (await this.db.delete(schema.agentTurns).where(lt(schema.agentTurns.startedAt, before)).returning({ id: schema.agentTurns.id })).length;
  }

  async notes(businessId: string): Promise<string[]> {
    const [row] = await this.db.select().from(schema.agentNotes).where(eq(schema.agentNotes.businessId, businessId));
    return (row?.notes as string[] | undefined) ?? [];
  }

  async saveNotes(businessId: string, notes: readonly string[]): Promise<void> {
    await this.db
      .insert(schema.agentNotes)
      .values({ businessId, notes: [...notes] })
      .onConflictDoUpdate({ target: schema.agentNotes.businessId, set: { notes: [...notes] } });
  }

  async addInboxEvent(event: Omit<InboxEvent, "id" | "consumedByTurnId">): Promise<void> {
    await this.db.insert(schema.agentInbox).values({ id: randomUUID(), businessId: event.businessId, event: event.trigger, createdAt: event.createdAt });
  }

  async pendingInbox(businessId: string): Promise<InboxEvent[]> {
    const rows = await this.db.select().from(schema.agentInbox).where(and(eq(schema.agentInbox.businessId, businessId), isNull(schema.agentInbox.consumedByTurnId))).orderBy(asc(schema.agentInbox.createdAt));
    return rows.map((r) => ({ id: r.id, businessId: r.businessId, trigger: r.event as InboxEvent["trigger"], createdAt: r.createdAt, consumedByTurnId: r.consumedByTurnId }));
  }

  async consumeInbox(ids: readonly string[], turnId: string): Promise<void> {
    if (ids.length > 0) {
      await this.db.update(schema.agentInbox).set({ consumedByTurnId: turnId }).where(inArray(schema.agentInbox.id, [...ids]));
    }
  }

  async saveApproval(r: ApprovalRequest): Promise<void> {
    const values = { ...r, command: r.command };
    await this.db.insert(schema.approvalRequests).values(values).onConflictDoUpdate({ target: schema.approvalRequests.id, set: values });
  }

  async approvals(businessId: string): Promise<ApprovalRequest[]> {
    const rows = await this.db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.businessId, businessId)).orderBy(asc(schema.approvalRequests.createdAt));
    return rows.map((r) => ({ ...r, command: r.command as ApprovalRequest["command"] }));
  }

  async saveClientConfirmation(c: ClientConfirmation): Promise<void> {
    await this.db
      .insert(schema.clientConfirmations)
      .values(c)
      .onConflictDoUpdate({ target: [schema.clientConfirmations.businessId, schema.clientConfirmations.weekStart], set: { clients: c.clients, leads: c.leads } });
  }

  async clientConfirmations(businessId: string): Promise<ClientConfirmation[]> {
    return this.db.select().from(schema.clientConfirmations).where(eq(schema.clientConfirmations.businessId, businessId));
  }

  async getFlag(name: FlagName, businessId: string | null): Promise<boolean> {
    const rows = await this.db.select().from(schema.runtimeFlags).where(eq(schema.runtimeFlags.name, name));
    if (rows.find((r) => r.businessId === GLOBAL)?.enabled === false) {
      return false;
    }
    return businessId === null ? true : (rows.find((r) => r.businessId === businessId)?.enabled ?? true);
  }

  async setFlag(name: FlagName, enabled: boolean, businessId: string | null): Promise<void> {
    const values = { name, businessId: businessId ?? GLOBAL, enabled, updatedAt: new Date() };
    await this.db
      .insert(schema.runtimeFlags)
      .values(values)
      .onConflictDoUpdate({ target: [schema.runtimeFlags.name, schema.runtimeFlags.businessId], set: { enabled, updatedAt: values.updatedAt } });
  }

  async beat(name: string, at: Date): Promise<void> {
    await this.db.insert(schema.heartbeats).values({ name, at }).onConflictDoUpdate({ target: schema.heartbeats.name, set: { at } });
  }

  async lastBeat(name: string): Promise<Date | null> {
    const [row] = await this.db.select().from(schema.heartbeats).where(eq(schema.heartbeats.name, name));
    return row?.at ?? null;
  }

  async openIncident(i: Omit<Incident, "id">): Promise<void> {
    await this.db.insert(schema.incidents).values({ ...i, id: randomUUID() });
  }

  async incidents(): Promise<Incident[]> {
    const rows = await this.db.select().from(schema.incidents).orderBy(asc(schema.incidents.openedAt));
    return rows.map((r) => ({ id: r.id, kind: r.kind as Incident["kind"], businessId: r.businessId, message: r.message, openedAt: r.openedAt }));
  }

  async notify(n: Notification): Promise<void> {
    await this.db.insert(schema.notifications).values({ id: randomUUID(), businessId: n.businessId, kind: n.kind, message: n.message, createdAt: n.at });
  }

  async unsentNotifications(): Promise<StoredNotification[]> {
    const rows = await this.db.select().from(schema.notifications).where(isNull(schema.notifications.sentAt)).orderBy(asc(schema.notifications.createdAt));
    return rows.map((r) => ({ id: r.id, businessId: r.businessId, kind: r.kind, message: r.message, at: r.createdAt, sentAt: r.sentAt }));
  }

  async markNotificationSent(id: string, at: Date): Promise<void> {
    await this.db.update(schema.notifications).set({ sentAt: at }).where(eq(schema.notifications.id, id));
  }

  async revokePlatformAccount(businessId: string, at: Date): Promise<void> {
    await this.db.update(schema.platformAccounts).set({ revokedAt: at, accessTokenEnc: "", refreshTokenEnc: null }).where(eq(schema.platformAccounts.businessId, businessId));
  }

  async markOwnerDeleted(businessId: string, at: Date): Promise<void> {
    const business = await this.getBusiness(businessId);
    await this.db.update(schema.users).set({ deletedAt: at }).where(eq(schema.users.id, business.userId));
  }

  async purgeDeletedOwners(before: Date): Promise<number> {
    const rows = await this.db
      .update(schema.users)
      .set({ email: sql`'deleted-' || ${schema.users.id} || '@invalid'`, name: null, googleSub: sql`'deleted-' || ${schema.users.id}` })
      .where(and(lt(schema.users.deletedAt, before), sql`${schema.users.email} NOT LIKE 'deleted-%@invalid'`))
      .returning({ id: schema.users.id });
    return rows.length;
  }

  async ownerEmail(businessId: string): Promise<string> {
    const [row] = await this.db.select({ email: schema.users.email }).from(schema.businesses).innerJoin(schema.users, eq(schema.businesses.userId, schema.users.id)).where(eq(schema.businesses.id, businessId));
    if (!row) {
      throw new Error(`No owner email for ${businessId}`);
    }
    return row.email;
  }

  async notifications(businessId: string): Promise<Notification[]> {
    const rows = await this.db.select().from(schema.notifications).where(eq(schema.notifications.businessId, businessId));
    return rows.map((r) => ({ businessId: r.businessId, kind: r.kind, message: r.message, at: r.createdAt }));
  }
}
