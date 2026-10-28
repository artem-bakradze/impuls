import { guard, toLocalDate } from "@impuls/core";
import type { Actor, Command } from "@impuls/core";
import { PlatformError } from "@impuls/platforms";
import type { AdPlatform, PlatformAd, PlatformCampaign } from "@impuls/platforms";
import { publishMiniSite, renderMiniSite } from "@impuls/minisite";
import type { MiniSiteCard, MiniSiteStore } from "@impuls/minisite";
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
  | { kind: "minisite"; business: BusinessRecord & { miniSite: NonNullable<BusinessRecord["miniSite"]> } };

export const directionSnapshot = (d: { status: string; weeklyLimit: number; strategyId: string }): Snapshot => ({
  status: d.status,
  weeklyLimit: d.weeklyLimit,
  strategyId: d.strategyId,
});

export const adSnapshot = (a: { status: string; title: string; text: string }): Snapshot => ({ status: a.status, title: a.title, text: a.text });

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
      default: {
        const direction = (await store.directions(businessId)).find((d) => d.id === command.directionId);
        return direction ? { kind: "direction", record: direction } : null;
      }
    }
  }

  private async platformSnapshot(platform: AdPlatform, target: Target, businessId: string): Promise<Snapshot> {
    switch (target.kind) {
      case "direction": {
        const [campaign] = await platform.getCampaigns([target.record.platformCampaignId]);
        return campaign ? directionSnapshot(campaign) : {};
      }
      case "ad": {
        const direction = (await this.deps.store.directions(businessId)).find((d) => d.id === target.record.directionId);
        const ads = direction ? await platform.getAds([direction.platformCampaignId]) : [];
        const ad = ads.find((a) => a.id === target.record.platformAdId);
        return ad ? adSnapshot(ad) : {};
      }
      case "minisite":
        return { card: target.business.miniSite.card };
      case "business": {
        const campaigns = await platform.getCampaigns(target.directions.map((d) => d.platformCampaignId));
        const byId = new Map(campaigns.map((c) => [c.id, c.status]));
        return Object.fromEntries(target.directions.map((d) => [d.id, byId.get(d.platformCampaignId) ?? "missing"]));
      }
    }
  }

  /** Current platform state of a logged object — used by rollback to show differences. */
  async currentPlatformSnapshot(businessId: string, objectKind: ChangeEntry["objectKind"], objectId: string): Promise<Snapshot> {
    const { store } = this.deps;
    const platform = this.deps.platformFor(businessId);
    if (objectKind === "direction") {
      const record = (await store.directions(businessId)).find((d) => d.id === objectId);
      return record ? this.platformSnapshot(platform, { kind: "direction", record }, businessId) : {};
    }
    if (objectKind === "ad") {
      const record = (await store.ads(businessId)).find((a) => a.id === objectId);
      return record ? this.platformSnapshot(platform, { kind: "ad", record }, businessId) : {};
    }
    if (objectKind === "minisite") {
      const business = await store.getBusiness(businessId);
      return business.miniSite ? { card: business.miniSite.card } : {};
    }
    return this.platformSnapshot(platform, { kind: "business", directions: await store.directions(businessId) }, businessId);
  }

  /** Logged snapshot: platform-checked fields plus the field a settings command changes. */
  private logSnapshot(target: Target, command: Command): Snapshot {
    const base = this.storedSnapshot(target);
    if (target.kind === "direction" && command.type === "UpdateSchedule") {
      return { ...base, schedule: target.record.schedule };
    }
    if (target.kind === "direction" && command.type === "UpdateGeo") {
      return { ...base, geoRadiusKm: target.record.geoRadiusKm };
    }
    return base;
  }

  private storedSnapshot(target: Target): Snapshot {
    switch (target.kind) {
      case "direction":
        return directionSnapshot(target.record);
      case "ad":
        return adSnapshot(target.record);
      case "business":
        return businessSnapshot(target.directions);
      case "minisite":
        return { card: target.business.miniSite.card };
    }
  }

  private async executeLocked(request: ExecutionRequest): Promise<ExecutionResult> {
    const { store, clock } = this.deps;
    const platform = this.deps.platformFor(request.businessId);
    const target = await this.resolveTarget(request.businessId, request.command);
    if (!target) {
      return { status: "rejected", code: "OBJECT_NOT_FOUND", message: "объект не найден" };
    }
    const before = this.storedSnapshot(target);
    // Reconciliation records platform state as is, so it skips the expected-before check.
    if (request.actor !== "reconciliation" && !sameSnapshot(before, await this.platformSnapshot(platform, target, request.businessId))) {
      return { status: "rejected", code: "STATE_CHANGED", message: "состояние объекта изменилось" };
    }
    const view = await loadBusinessView(store, request.businessId, clock, platform.capabilities());
    const verdict = guard(view.guardState, request.command, request.actor);
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
      objectId: target.kind === "business" || target.kind === "minisite" ? request.businessId : target.record.id,
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
      const after = await this.apply(request.businessId, target, command, platform, view.today, request.actor);
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

  private async apply(
    businessId: string,
    target: Target,
    command: Command,
    platform: AdPlatform,
    today: string,
    actor: Actor,
  ): Promise<Snapshot> {
    const { store } = this.deps;
    const saveCampaign = async (record: DirectionRecord, campaign: PlatformCampaign, patch: Partial<DirectionRecord> = {}) => {
      const updated = { ...record, status: campaign.status, weeklyLimit: campaign.weeklyLimit, strategyId: campaign.strategyId, ...patch };
      await store.saveDirection(updated);
      return directionSnapshot(updated);
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
        const campaign = await platform.updateCampaign(target.record.platformCampaignId, { strategyId: command.strategyId });
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
        return saveCampaign(target.record, campaign, { pausedByBudget: false });
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
        if (target.kind !== "direction") break;
        await store.saveExperiment({
          id: `exp-${businessId}-${command.adId}-${today}`,
          businessId,
          directionId: command.directionId,
          adId: command.adId,
          variantAdId: command.variantAdId ?? null,
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
        const campaign = await platform.updateCampaign(target.record.platformCampaignId, { geoRadiusKm: command.radiusKm });
        await saveCampaign(target.record, campaign, { geoRadiusKm: command.radiusKm });
        return { ...directionSnapshot(campaign), geoRadiusKm: command.radiusKm };
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
  async recoverPending(olderThanMs: number): Promise<number> {
    const { store, clock } = this.deps;
    let resolved = 0;
    for (const entry of await store.pendingChanges()) {
      if (clock.now().getTime() - entry.createdAt.getTime() < olderThanMs) {
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
    const target = await this.resolveTarget(entry.businessId, entry.action as Command);
    return target ? this.platformSnapshot(this.deps.platformFor(entry.businessId), target, entry.businessId) : {};
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
