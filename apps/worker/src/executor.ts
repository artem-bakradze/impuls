import { randomUUID } from "node:crypto";
import { guard, toLocalDate } from "@impuls/core";
import type { Actor, Command } from "@impuls/core";
import { PlatformError } from "@impuls/platforms";
import type { AdPlatform, LeadGoal, PlatformAd, PlatformCampaign } from "@impuls/platforms";
import { publishMiniSite, renderMiniSite } from "@impuls/minisite";
import type { MiniSiteCard, MiniSiteStore } from "@impuls/minisite";
import { desiredTraffic, isAnalystCommand, loadAnalystState, normalizePhrase, phrasesMissing, snapshotPhrases, trafficSnapshot } from "./analyst";
import type { Clock } from "./clock";
import { businessLockKey } from "./locks";
import type { LockManager } from "./locks";
import { loadBusinessView } from "./state";
import type { AdRecord, BusinessRecord, ChangeAuthor, ChangeEntry, DirectionRecord, Snapshot, Store } from "./store";

export interface ExecutionRequest {
  businessId: string;
  command: Command;
  actor: Actor;
  reasonCode: string;
  /** Plain-language text shown in the history. */
  explanation: string;
  turnId?: string;
}

export type ExecutionResult =
  | { status: "applied"; entryId: string; command: Command; message: string }
  | { status: "clamped"; entryId: string; command: Command; message: string }
  | { status: "rejected"; code: string; message: string }
  | { status: "failed"; entryId: string; code: string; message: string };

type Target =
  | { kind: "direction"; record: DirectionRecord }
  | { kind: "ad"; record: AdRecord }
  | { kind: "business"; directions: DirectionRecord[] }
  | { kind: "minisite"; business: BusinessRecord & { miniSite: NonNullable<BusinessRecord["miniSite"]> } }
  /** The owner's cost-per-lead goal; it lives only in the service, so «platform» state is the stored one. */
  | { kind: "goal"; business: BusinessRecord }
  /** What the business sells; like the goal, it lives only in the service. */
  | { kind: "card"; business: BusinessRecord };

export const directionSnapshot = (d: { status: string; weeklyLimit: number; strategyId: string }): Snapshot => ({
  status: d.status,
  weeklyLimit: d.weeklyLimit,
  strategyId: d.strategyId,
});

export const adSnapshot = (a: { status: string; title: string; text: string }): Snapshot => ({ status: a.status, title: a.title, text: a.text });

export const goalSnapshot = (business: BusinessRecord): Snapshot => ({
  csoMode: business.csoSource.kind,
  csoValue: business.csoSource.kind === "user" ? business.csoSource.goal : business.csoSource.reference,
});

/** Card fields the owner edits; lists are JSON so a rollback restores them exactly. */
export const cardSnapshot = (business: BusinessRecord): Snapshot => ({
  category: business.card.category,
  services: JSON.stringify(business.card.services),
  advantages: JSON.stringify(business.card.advantages),
});

const businessSnapshot = (directions: readonly DirectionRecord[]): Snapshot =>
  Object.fromEntries(directions.map((d) => [d.id, d.status]));

const sameSnapshot = (a: Snapshot, b: Snapshot): boolean =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);

const authorOf = (actor: Actor): ChangeAuthor => (actor === "user" ? "user" : actor === "reconciliation" ? "cabinet" : "service");

/**
 * The only executor of changes (design decision 3). Per-business lock → expected-before check →
 * guard on current state → pending log entry → platform call → applied/failed.
 */
export class CommandExecutor {
  constructor(
    private readonly deps: {
      store: Store;
      locks: LockManager;
      clock: Clock;
      platformFor: (businessId: string) => AdPlatform;
      /** Static hosting for mini-sites; required only for mini-site commands. */
      miniSites?: MiniSiteStore;
    },
  ) {}

  execute(request: ExecutionRequest): Promise<ExecutionResult> {
    return this.deps.locks.withLock(businessLockKey(request.businessId), () => this.executeLocked(request));
  }

  private async resolveTarget(businessId: string, command: Command): Promise<Target | null> {
    const { store } = this.deps;
    switch (command.type) {
      case "PauseAd":
      case "ResumeAd":
      case "UpdateAdText": {
        const ad = (await store.ads(businessId)).find((a) => a.id === command.adId);
        return ad ? { kind: "ad", record: ad } : null;
      }
      case "PauseAll":
      case "ResumeAll":
        return { kind: "business", directions: await store.directions(businessId) };
      case "UpdateMiniSite":
      case "PublishMiniSite": {
        const business = await store.getBusiness(businessId);
        const miniSite = business.miniSite;
        return miniSite ? { kind: "minisite", business: { ...business, miniSite } } : null;
      }
      case "SetGoal":
        return { kind: "goal", business: await store.getBusiness(businessId) };
      case "UpdateCard":
        return { kind: "card", business: await store.getBusiness(businessId) };
      default: {
        const direction = (await store.directions(businessId)).find((d) => d.id === command.directionId);
        return direction ? { kind: "direction", record: direction } : null;
      }
    }
  }

  /** `withTraffic`: also the negative phrases and adjustments, read only when an analyst command needs them. */
  private async platformSnapshot(platform: AdPlatform, target: Target, businessId: string, withTraffic = false): Promise<Snapshot> {
    switch (target.kind) {
      case "direction": {
        const [campaign] = await platform.getCampaigns([target.record.platformCampaignId]);
        if (!campaign) {
          return {};
        }
        if (!withTraffic) {
          return directionSnapshot(campaign);
        }
        const [settings] = await platform.getTrafficSettings([target.record.platformCampaignId]);
        return settings ? { ...directionSnapshot(campaign), ...trafficSnapshot(settings) } : directionSnapshot(campaign);
      }
      case "ad": {
        const direction = (await this.deps.store.directions(businessId)).find((d) => d.id === target.record.directionId);
        const ads = direction ? await platform.getAds([direction.platformCampaignId]) : [];
        const ad = ads.find((a) => a.id === target.record.platformAdId);
        return ad ? adSnapshot(ad) : {};
      }
      case "minisite":
        return { card: target.business.miniSite.card };
      case "goal":
        return goalSnapshot(target.business);
      case "card":
        return cardSnapshot(target.business);
      case "business": {
        const campaigns = await platform.getCampaigns(target.directions.map((d) => d.platformCampaignId));
        const byId = new Map(campaigns.map((c) => [c.id, c.status]));
        return Object.fromEntries(target.directions.map((d) => [d.id, byId.get(d.platformCampaignId) ?? "missing"]));
      }
    }
  }

  /** Current platform state of a logged object — used by rollback to show differences. */
  async currentPlatformSnapshot(businessId: string, objectKind: ChangeEntry["objectKind"], objectId: string, withTraffic = false): Promise<Snapshot> {
    const { store } = this.deps;
    const platform = this.deps.platformFor(businessId);
    if (objectKind === "direction") {
      const record = (await store.directions(businessId)).find((d) => d.id === objectId);
      return record ? this.platformSnapshot(platform, { kind: "direction", record }, businessId, withTraffic) : {};
    }
    if (objectKind === "ad") {
      const record = (await store.ads(businessId)).find((a) => a.id === objectId);
      return record ? this.platformSnapshot(platform, { kind: "ad", record }, businessId) : {};
    }
    if (objectKind === "minisite") {
      const business = await store.getBusiness(businessId);
      return business.miniSite ? { card: business.miniSite.card } : {};
    }
    if (objectKind === "goal") {
      return goalSnapshot(await store.getBusiness(businessId));
    }
    if (objectKind === "card") {
      return cardSnapshot(await store.getBusiness(businessId));
    }
    return this.platformSnapshot(platform, { kind: "business", directions: await store.directions(businessId) }, businessId);
  }

  /** Logged snapshot: platform-checked fields plus the field a settings command changes. */
  private logSnapshot(target: Target, command: Command): Snapshot {
    const base = this.storedSnapshot(target, command);
    if (target.kind === "direction" && command.type === "UpdateSchedule") {
      return { ...base, schedule: target.record.schedule };
    }
    if (target.kind === "direction" && command.type === "UpdateGeo") {
      return { ...base, city: target.record.city };
    }
    return base;
  }

  private storedSnapshot(target: Target, command?: Command): Snapshot {
    switch (target.kind) {
      case "direction":
        return command !== undefined && isAnalystCommand(command)
          ? { ...directionSnapshot(target.record), ...trafficSnapshot(target.record) }
          : directionSnapshot(target.record);
      case "ad":
        return adSnapshot(target.record);
      case "business":
        return businessSnapshot(target.directions);
      case "minisite":
        return { card: target.business.miniSite.card };
      case "goal":
        return goalSnapshot(target.business);
      case "card":
        return cardSnapshot(target.business);
    }
  }

  private async executeLocked(request: ExecutionRequest): Promise<ExecutionResult> {
    const { store, clock } = this.deps;
    const platform = this.deps.platformFor(request.businessId);
    const target = await this.resolveTarget(request.businessId, request.command);
    if (!target) {
      return { status: "rejected", code: "OBJECT_NOT_FOUND", message: "объект не найден" };
    }
    const analyst = isAnalystCommand(request.command);
    const before = this.storedSnapshot(target, request.command);
    // Reconciliation records platform state as is, so it skips the expected-before check.
    if (request.actor !== "reconciliation" && !sameSnapshot(before, await this.platformSnapshot(platform, target, request.businessId, analyst))) {
      return { status: "rejected", code: "STATE_CHANGED", message: "состояние объекта изменилось" };
    }
    if (target.kind === "direction" && analyst && this.changesNothing(target.record, request.command)) {
      return { status: "rejected", code: "NO_CHANGE", message: "такие настройки у рекламы уже стоят" };
    }
    const view = await loadBusinessView(store, request.businessId, clock, platform.capabilities());
    let guardState = view.guardState;
    // The analyst guardrails need a fresh breakdown; only automated actors are checked by them.
    if (target.kind === "direction" && isAnalystCommand(request.command) && (request.actor === "agent" || request.actor === "safety_net")) {
      const state = await loadAnalystState(platform, target.record, request.command, {
        today: view.today,
        timeZone: view.business.timeZone,
        changes: await store.changes(request.businessId),
      });
      guardState = { ...guardState, analyst: new Map([[target.record.id, state]]) };
    }
    const verdict = guard(guardState, request.command, request.actor);
    if (verdict.kind === "reject") {
      return { status: "rejected", code: verdict.reason.code, message: verdict.reason.message };
    }
    const command = verdict.command;
    const logged = this.logSnapshot(target, command);
    const entry = await store.appendChange({
      businessId: request.businessId,
      actor: request.actor,
      author: authorOf(request.actor),
      action: command,
      objectKind: target.kind,
      objectId: target.kind === "business" || target.kind === "minisite" || target.kind === "goal" || target.kind === "card" ? request.businessId : target.record.id,
      before: logged,
      after: logged,
      status: "pending",
      reasonCode: request.reasonCode,
      explanation: request.explanation,
      turnId: request.turnId ?? null,
      createdAt: clock.now(),
      error: null,
      revertedById: null,
      outcome: null,
    });
    try {
      const leadGoal = view.business.leadGoalId === null ? null : { goalId: view.business.leadGoalId, targetCostPerLead: view.cso };
      const after = await this.apply(request.businessId, target, command, platform, view.today, request.actor, leadGoal);
      await store.updateChange(entry.id, { status: "applied", after });
      return verdict.kind === "clamp"
        ? { status: "clamped", entryId: entry.id, command, message: verdict.reason.message }
        : { status: "applied", entryId: entry.id, command, message: "выполнено" };
    } catch (error) {
      const code = error instanceof PlatformError ? error.code : "INTERNAL_ERROR";
      await store.updateChange(entry.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      return { status: "failed", entryId: entry.id, code, message: "площадка не приняла изменение" };
    }
  }

  /** An analyst command that would leave the settings as they are (e.g. removing a phrase that is not there). */
  private changesNothing(record: DirectionRecord, command: Command): boolean {
    switch (command.type) {
      case "AddNegativeKeywords":
        return phrasesMissing(command.phrases, record.negativeKeywords).length === 0;
      case "RemoveNegativeKeywords":
        return phrasesMissing(command.phrases, record.negativeKeywords).length === command.phrases.length;
      case "SetDeviceAdjustment":
        return record.deviceAdjustments[command.device] === command.percent;
      default:
        return false;
    }
  }

  private async apply(
    businessId: string,
    target: Target,
    command: Command,
    platform: AdPlatform,
    today: string,
    actor: Actor,
    leadGoal: LeadGoal | null,
  ): Promise<Snapshot> {
    const { store } = this.deps;
    const saveCampaign = async (record: DirectionRecord, campaign: PlatformCampaign, patch: Partial<DirectionRecord> = {}) => {
      const updated = { ...record, status: campaign.status, weeklyLimit: campaign.weeklyLimit, strategyId: campaign.strategyId, ...patch };
      await store.saveDirection(updated);
      return directionSnapshot(updated);
    };
    const saveTraffic = async (record: DirectionRecord, campaign: PlatformCampaign, patch: Pick<DirectionRecord, "negativeKeywords"> | Pick<DirectionRecord, "deviceAdjustments" | "deviceAdjustedOn">) => {
      const updated = { ...record, status: campaign.status, weeklyLimit: campaign.weeklyLimit, strategyId: campaign.strategyId, ...patch };
      await store.saveDirection(updated);
      return { ...directionSnapshot(updated), ...trafficSnapshot(updated) };
    };
    const saveAd = async (record: AdRecord, ad: PlatformAd) => {
      const updated = { ...record, status: ad.status, title: ad.title, text: ad.text };
      await store.saveAd(updated);
      return adSnapshot(updated);
    };
    switch (command.type) {
      case "SetSpendLimit": {
        if (target.kind !== "direction") break;
        const campaign = await platform.updateCampaign(target.record.platformCampaignId, { weeklyLimit: command.weeklyLimit });
        const increased = command.weeklyLimit > target.record.weeklyLimit;
        return saveCampaign(target.record, campaign, increased ? { lastLimitIncreaseOn: today } : {});
      }
      case "SetStrategy": {
        if (target.kind !== "direction") break;
        // The guard has already refused lead-paying strategies without a goal; the ЦСО is the current one.
        const campaign = await platform.updateCampaign(target.record.platformCampaignId, { strategyId: command.strategyId, ...(leadGoal && { leadGoal }) });
        return saveCampaign(target.record, campaign, { lastStrategyChangeOn: today });
      }
      case "PauseDirection":
      case "ResumeDirection": {
        if (target.kind !== "direction") break;
        const patch =
          command.type === "PauseDirection"
            ? { status: "paused" as const }
            : { status: "active" as const, ...(command.weeklyLimit !== undefined ? { weeklyLimit: command.weeklyLimit } : {}) };
        const campaign = await platform.updateCampaign(target.record.platformCampaignId, patch);
        // A shortage pause of the budget guard is marked, so the guard resumes it when the budget has room again.
        return saveCampaign(target.record, campaign, { pausedByBudget: command.type === "PauseDirection" && actor === "budget_guard" });
      }
      case "PauseAd":
      case "ResumeAd": {
        if (target.kind !== "ad") break;
        const ad = await platform.updateAd(target.record.platformAdId, { status: command.type === "PauseAd" ? "paused" : "active" });
        return saveAd(target.record, ad);
      }
      case "PauseAll":
      case "ResumeAll": {
        if (target.kind !== "business") break;
        // The budget guard and the owner pause independently: the 1st of the month only resumes budget pauses.
        const pausing = command.type === "PauseAll";
        const marker = actor === "budget_guard" ? "pausedByBudget" : "pausedByUser";
        const updated: DirectionRecord[] = [];
        for (const direction of target.directions) {
          if (pausing && direction.status === "active") {
            const campaign = await platform.updateCampaign(direction.platformCampaignId, { status: "paused" });
            updated.push({ ...direction, status: campaign.status, [marker]: true });
          } else if (pausing && direction.status === "paused" && actor !== "budget_guard" && direction.pausedByBudget) {
            updated.push({ ...direction, pausedByUser: true });
          } else if (!pausing && direction[marker]) {
            const stillHeld = marker === "pausedByBudget" ? direction.pausedByUser : false;
            if (stillHeld) {
              updated.push({ ...direction, pausedByBudget: false });
              continue;
            }
            const campaign = await platform.updateCampaign(direction.platformCampaignId, { status: "active" });
            updated.push({ ...direction, status: campaign.status, pausedByBudget: false, pausedByUser: false });
          } else {
            updated.push(direction);
          }
        }
        for (const direction of updated) {
          await store.saveDirection(direction);
        }
        return businessSnapshot(updated);
      }
      case "StartExperiment": {
        if (target.kind !== "direction" || command.variant === undefined) break;
        // The variant is a second ad of the same group, so Direct rotates both inside the campaign's limit (ab-testing spec).
        const business = await store.getBusiness(businessId);
        if (business.card.siteUrl === "") {
          throw new Error(`Business ${businessId} has no site URL for a new ad`);
        }
        // The variant differs by its text alone: it shows the original's picture without uploading it again.
        const original = (await store.ads(businessId)).find((a) => a.id === command.adId);
        const imageHash = original?.imageHash ?? null;
        const created = await platform.createAd({
          campaignId: target.record.platformCampaignId,
          title: command.variant.title,
          text: command.variant.text,
          landingUrl: business.card.siteUrl,
          ...(imageHash !== null && { imageHash }),
        });
        const variantAdId = `ad-${randomUUID()}`;
        await store.saveAd({
          id: variantAdId,
          directionId: command.directionId,
          status: created.status,
          title: created.title,
          text: created.text,
          createdOn: today,
          platformAdId: created.id,
          moderation: created.moderation,
          imageId: original?.imageId ?? null,
          imageHash: created.imageHash,
        });
        await store.saveExperiment({
          id: `exp-${businessId}-${command.adId}-${today}`,
          businessId,
          directionId: command.directionId,
          adId: command.adId,
          variantAdId,
          hypothesis: command.hypothesis,
          startedOn: today,
          status: "running",
          outcome: null,
        });
        return directionSnapshot(target.record);
      }
      case "FinishExperiment": {
        if (target.kind !== "direction") break;
        const loser = (await store.ads(businessId)).find((a) => a.id === command.pauseAdId);
        if (loser && loser.status === "active") {
          const ad = await platform.updateAd(loser.platformAdId, { status: "paused" });
          await saveAd(loser, ad);
        }
        const experiment = (await store.experiments(businessId)).find((e) => e.id === command.experimentId);
        if (experiment) {
          await store.saveExperiment({ ...experiment, status: "finished" });
        }
        return directionSnapshot(target.record);
      }
      case "UpdateSchedule": {
        if (target.kind !== "direction") break;
        const campaign = await platform.updateCampaign(target.record.platformCampaignId, { schedule: command.schedule });
        await saveCampaign(target.record, campaign, { schedule: command.schedule });
        return { ...directionSnapshot(campaign), schedule: command.schedule };
      }
      case "UpdateGeo": {
        if (target.kind !== "direction") break;
        const campaign = await platform.updateCampaign(target.record.platformCampaignId, { city: command.city });
        await saveCampaign(target.record, campaign, { city: command.city });
        return { ...directionSnapshot(campaign), city: command.city };
      }
      case "SetGoal": {
        if (target.kind !== "goal") break;
        const updated = { ...target.business, csoSource: command.source };
        await store.saveBusiness(updated);
        return goalSnapshot(updated);
      }
      case "UpdateCard": {
        if (target.kind !== "card") break;
        const updated = { ...target.business, card: { ...target.business.card, ...command.card } };
        await store.saveBusiness(updated);
        return cardSnapshot(updated);
      }
      case "UpdateMiniSite":
      case "PublishMiniSite": {
        if (target.kind !== "minisite") break;
        const miniSite = command.type === "UpdateMiniSite" ? { ...target.business.miniSite, card: command.card } : target.business.miniSite;
        await this.publish(miniSite);
        if (command.type === "UpdateMiniSite") {
          await store.saveBusiness({ ...target.business, miniSite });
          await this.suggestAdUpdates(businessId, target.business.miniSite.card, command.card);
        }
        return { card: miniSite.card };
      }
      case "UpdateAdText": {
        if (target.kind !== "ad") break;
        const ad = await platform.updateAd(target.record.platformAdId, { title: command.title, text: command.text });
        return saveAd(target.record, ad);
      }
      case "AddNegativeKeywords":
      case "RemoveNegativeKeywords": {
        if (target.kind !== "direction") break;
        // The platform takes the whole list: the phrases of other entries stay (change-history spec).
        const current = target.record.negativeKeywords;
        const removed = new Set(command.type === "RemoveNegativeKeywords" ? command.phrases.map(normalizePhrase) : []);
        const negativeKeywords =
          command.type === "AddNegativeKeywords" ? [...current, ...phrasesMissing(command.phrases, current)] : current.filter((p) => !removed.has(normalizePhrase(p)));
        const campaign = await platform.updateCampaign(target.record.platformCampaignId, { negativeKeywords });
        return saveTraffic(target.record, campaign, { negativeKeywords });
      }
      case "SetDeviceAdjustment": {
        if (target.kind !== "direction") break;
        const deviceAdjustments = { ...target.record.deviceAdjustments, [command.device]: command.percent };
        const campaign = await platform.updateCampaign(target.record.platformCampaignId, { deviceAdjustments });
        return saveTraffic(target.record, campaign, { deviceAdjustments, deviceAdjustedOn: { ...target.record.deviceAdjustedOn, [command.device]: today } });
      }
    }
    throw new Error(`Command ${command.type} does not match target ${target.kind}`);
  }

  private async publish(miniSite: NonNullable<BusinessRecord["miniSite"]>): Promise<void> {
    if (!this.deps.miniSites) {
      throw new Error("Mini-site store is not configured");
    }
    const card = JSON.parse(miniSite.card) as MiniSiteCard;
    const rendered = renderMiniSite(card, { metrikaCounterId: miniSite.metrikaCounterId, advertiser: miniSite.advertiser });
    await publishMiniSite(this.deps.miniSites, miniSite.slug, rendered);
  }

  /** When a price changes on the mini-site, offers to update ads that still mention the old price. */
  private async suggestAdUpdates(businessId: string, beforeCard: string, afterCard: string): Promise<void> {
    const before = JSON.parse(beforeCard) as MiniSiteCard;
    const after = JSON.parse(afterCard) as MiniSiteCard;
    const format = (kopecks: number): string => `${Math.round(kopecks / 100).toLocaleString("ru-RU").replace(/\u00a0/g, " ")} ₽`;
    const ads = await this.deps.store.ads(businessId);
    for (const service of before.services) {
      const updated = after.services.find((s) => s.name === service.name);
      if (!updated || updated.price === service.price) continue;
      const oldPrice = format(service.price);
      const stale = ads.filter((a) => `${a.title} ${a.text}`.includes(oldPrice));
      if (stale.length > 0) {
        await this.deps.store.notify({
          businessId,
          kind: "minisite_price_changed",
          message: `Цена «${service.name}» теперь ${format(updated.price)}, а в объявлениях: ${stale.map((a) => `«${a.title}»`).join(", ")} — ещё ${oldPrice}. Обновить объявления?`,
          at: this.deps.clock.now(),
        });
      }
    }
  }

  /**
   * Resolves pending entries left by a crash between the platform call and the result write:
   * platform matches `after` → applied; matches `before` → failed (not applied); otherwise failed and left to reconciliation.
   */
  async recoverPending(olderThanMs: number, ofBusiness: (businessId: string) => boolean = () => true): Promise<number> {
    const { store, clock } = this.deps;
    let resolved = 0;
    for (const entry of await store.pendingChanges()) {
      // Each executor resolves only entries of businesses on its own platform (Direct vs a simulation).
      if (!ofBusiness(entry.businessId) || clock.now().getTime() - entry.createdAt.getTime() < olderThanMs) {
        continue;
      }
      await this.deps.locks.withLock(businessLockKey(entry.businessId), async () => {
        const actual = await this.actualSnapshot(entry);
        const desired = this.desiredSnapshot(entry);
        if (desired !== null && sameSnapshot(actual, desired)) {
          await store.updateChange(entry.id, { status: "applied", after: actual });
          await this.syncRecord(entry, actual);
        } else if (sameSnapshot(actual, entry.before)) {
          await store.updateChange(entry.id, { status: "failed", error: "not applied by the platform" });
        } else {
          await store.updateChange(entry.id, { status: "failed", error: "unexpected platform state; reconciliation will record it" });
        }
        resolved++;
      });
    }
    return resolved;
  }

  private async actualSnapshot(entry: ChangeEntry): Promise<Snapshot> {
    const command = entry.action as Command;
    const target = await this.resolveTarget(entry.businessId, command);
    return target ? this.platformSnapshot(this.deps.platformFor(entry.businessId), target, entry.businessId, isAnalystCommand(command)) : {};
  }

  private desiredSnapshot(entry: ChangeEntry): Snapshot | null {
    const command = entry.action as Command;
    const before = entry.before;
    switch (command.type) {
      case "SetSpendLimit":
        return { ...before, weeklyLimit: command.weeklyLimit };
      case "SetStrategy":
        return { ...before, strategyId: command.strategyId };
      case "PauseDirection":
      case "PauseAd":
        return { ...before, status: "paused" };
      case "ResumeDirection":
        return { ...before, status: "active", ...(command.weeklyLimit !== undefined ? { weeklyLimit: command.weeklyLimit } : {}) };
      case "ResumeAd":
        return { ...before, status: "active" };
      case "UpdateAdText":
        return { ...before, title: command.title, text: command.text };
      case "AddNegativeKeywords":
      case "RemoveNegativeKeywords":
      case "SetDeviceAdjustment":
        return desiredTraffic(before, command);
      default:
        return null;
    }
  }

  private async syncRecord(entry: ChangeEntry, actual: Snapshot): Promise<void> {
    const { store } = this.deps;
    if (entry.objectKind === "direction") {
      const record = (await store.directions(entry.businessId)).find((d) => d.id === entry.objectId);
      if (record) {
        await store.saveDirection({
          ...record,
          status: actual.status === "paused" ? "paused" : "active",
          weeklyLimit: Number(actual.weeklyLimit),
          strategyId: String(actual.strategyId),
          ...("negativeKeywords" in actual && {
            negativeKeywords: snapshotPhrases(actual),
            deviceAdjustments: { mobile: Number(actual.mobileAdjustment), desktop: Number(actual.desktopAdjustment) },
          }),
        });
      }
    } else if (entry.objectKind === "ad") {
      const record = (await store.ads(entry.businessId)).find((a) => a.id === entry.objectId);
      if (record) {
        await store.saveAd({ ...record, status: actual.status === "paused" ? "paused" : "active", title: String(actual.title), text: String(actual.text) });
      }
    }
  }
}

export const localToday = (clock: Clock, timeZone: string): string => toLocalDate(clock.now(), timeZone);
