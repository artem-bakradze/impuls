import { addDays, costPerLead, toLocalDate } from "@impuls/core";
import type { Command, PerformanceStats } from "@impuls/core";
import type { JobContext } from "./context";
import { reconcile } from "./jobs";
import { aggregate } from "./state";
import type { ChangeEntry, LoggedAction, Snapshot } from "./store";

interface ActionMeta {
  reversible: boolean;
  /** Shown before the user confirms a rollback (change-history spec). */
  rollbackConsequences: string[];
  irreversibleReason?: string;
}

const KEEPS_STATS = "статистика за прошлые дни сохранится";

export const ACTION_META: Record<LoggedAction["type"], ActionMeta> = {
  SetSpendLimit: { reversible: true, rollbackConsequences: ["лимит будет ограничен остатком бюджета на месяц", KEEPS_STATS] },
  SetStrategy: { reversible: true, rollbackConsequences: ["Яндексу снова понадобится несколько дней на обучение", KEEPS_STATS] },
  PauseAd: { reversible: true, rollbackConsequences: ["объявление снова начнёт показываться", KEEPS_STATS] },
  ResumeAd: { reversible: true, rollbackConsequences: ["объявление перестанет показываться", KEEPS_STATS] },
  PauseDirection: { reversible: true, rollbackConsequences: ["направление снова начнёт тратить деньги в пределах лимита", KEEPS_STATS] },
  ResumeDirection: { reversible: true, rollbackConsequences: ["направление перестанет показываться", KEEPS_STATS] },
  PauseAll: { reversible: true, rollbackConsequences: ["реклама снова начнёт показываться"] },
  ResumeAll: { reversible: true, rollbackConsequences: ["вся реклама сервиса остановится"] },
  UpdateSchedule: { reversible: true, rollbackConsequences: ["вернётся прежнее расписание показов"] },
  UpdateGeo: { reversible: true, rollbackConsequences: ["вернётся прежняя зона показа"] },
  UpdateAdText: { reversible: true, rollbackConsequences: ["объявление снова пройдёт проверку Яндекса", KEEPS_STATS] },
  StartExperiment: {
    reversible: false,
    rollbackConsequences: [],
    irreversibleReason: "проверку нельзя отменить задним числом — её можно только дождаться или остановить новым решением",
  },
  FinishExperiment: { reversible: false, rollbackConsequences: [], irreversibleReason: "итог проверки уже посчитан по фактическим данным" },
  UpdateMiniSite: { reversible: true, rollbackConsequences: ["на мини-сайте снова появятся прежние тексты и цены"] },
  PublishMiniSite: { reversible: false, rollbackConsequences: [], irreversibleReason: "публикация лишь обновляет сайт по текущим данным" },
  ExternalChange: { reversible: true, rollbackConsequences: ["вернётся состояние, которое было до изменения в кабинете", KEEPS_STATS] },
};

/** Commands that restore the `before` snapshot of an entry, or null when the action cannot be undone. */
export const inverseCommands = (entry: ChangeEntry): Command[] | null => {
  if (!ACTION_META[entry.action.type].reversible) {
    return null;
  }
  const { before, after } = entry;
  if (entry.objectKind === "business" && entry.action.type === "ExternalChange") {
    return null;
  }
  if (entry.objectKind === "minisite") {
    return [{ type: "UpdateMiniSite", card: String(before.card) }];
  }
  if (entry.objectKind === "business") {
    return [entry.action.type === "ResumeAll" ? { type: "PauseAll" } : { type: "ResumeAll" }];
  }
  const commands: Command[] = [];
  if (entry.objectKind === "ad") {
    if (before.status !== after.status) {
      commands.push(before.status === "active" ? { type: "ResumeAd", adId: entry.objectId } : { type: "PauseAd", adId: entry.objectId });
    }
    if (before.title !== after.title || before.text !== after.text) {
      commands.push({ type: "UpdateAdText", adId: entry.objectId, title: String(before.title), text: String(before.text) });
    }
    return commands;
  }
  const directionId = entry.objectId;
  if (before.status !== after.status) {
    commands.push(
      before.status === "active"
        ? { type: "ResumeDirection", directionId, weeklyLimit: Number(before.weeklyLimit) }
        : { type: "PauseDirection", directionId },
    );
  } else if (before.weeklyLimit !== after.weeklyLimit) {
    commands.push({ type: "SetSpendLimit", directionId, weeklyLimit: Number(before.weeklyLimit) });
  }
  if (before.strategyId !== after.strategyId) {
    commands.push({ type: "SetStrategy", directionId, strategyId: String(before.strategyId) });
  }
  if ("schedule" in before && before.schedule !== after.schedule) {
    commands.push({ type: "UpdateSchedule", directionId, schedule: String(before.schedule) });
  }
  if ("geoRadiusKm" in before && before.geoRadiusKm !== after.geoRadiusKm) {
    commands.push({ type: "UpdateGeo", directionId, radiusKm: Number(before.geoRadiusKm) });
  }
  return commands;
};

export type RollbackResult =
  | { kind: "not_reversible"; reason: string }
  | { kind: "needs_chain"; later: ChangeEntry[] }
  | { kind: "state_differs"; expected: Snapshot; actual: Snapshot }
  | { kind: "done"; entryIds: string[]; messages: string[] }
  | { kind: "failed"; message: string };

const pickFields = (snapshot: Snapshot, keys: readonly string[]): Snapshot =>
  Object.fromEntries(keys.filter((k) => k in snapshot).map((k) => [k, snapshot[k] ?? null]));

const sameOn = (a: Snapshot, b: Snapshot, keys: readonly string[]): boolean => keys.every((k) => !(k in a) || !(k in b) || a[k] === b[k]);

/**
 * «Вернуть как было» (change-history spec). Later changes of the same object must be rolled back together,
 * from the newest; if the cabinet state differs from the saved «стало», the user must confirm first.
 */
export const rollback = async (
  ctx: JobContext,
  input: { businessId: string; entryId: string; includeLater?: boolean; confirmDifference?: boolean },
): Promise<RollbackResult> => {
  const { store } = ctx;
  const all = await store.changes(input.businessId);
  const entry = all.find((c) => c.id === input.entryId);
  if (!entry || entry.status !== "applied") {
    return { kind: "not_reversible", reason: "это изменение не было применено" };
  }
  if (entry.revertedById !== null) {
    return { kind: "not_reversible", reason: "это изменение уже отменено" };
  }
  const meta = ACTION_META[entry.action.type];
  if (!meta.reversible) {
    return { kind: "not_reversible", reason: meta.irreversibleReason ?? "это изменение нельзя отменить" };
  }
  if (inverseCommands(entry) === null) {
    return { kind: "not_reversible", reason: "бюджет меняется в настройках — укажите нужную сумму там" };
  }
  // The journal is ordered; position (not timestamp) decides what is later, since timestamps can tie.
  const later = all
    .slice(all.indexOf(entry) + 1)
    .filter((c) => c.objectId === entry.objectId && c.status === "applied" && c.revertedById === null && c.reasonCode !== "USER_ROLLBACK");
  if (later.length > 0 && input.includeLater !== true) {
    return { kind: "needs_chain", later };
  }
  const chain = [...later].reverse();
  chain.push(entry);
  if (chain.some((c) => !ACTION_META[c.action.type].reversible)) {
    return { kind: "not_reversible", reason: "в цепочке есть изменение, которое нельзя отменить" };
  }

  const newest = chain[0] ?? entry;
  const actual = await ctx.executor.currentPlatformSnapshot(input.businessId, newest.objectKind, newest.objectId);
  const keys = Object.keys(actual);
  if (!sameOn(newest.after, actual, keys)) {
    if (input.confirmDifference !== true) {
      return { kind: "state_differs", expected: pickFields(newest.after, keys), actual };
    }
    await reconcile(ctx, input.businessId);
  }

  const today = toLocalDate(ctx.clock.now(), (await store.getBusiness(input.businessId)).timeZone);
  const entryIds: string[] = [];
  const messages: string[] = [];
  for (const item of chain) {
    for (const command of inverseCommands(item) ?? []) {
      const result = await ctx.executor.execute({
        businessId: input.businessId,
        command,
        actor: "user",
        reasonCode: "USER_ROLLBACK",
        explanation: `Вы отменили изменение: ${item.explanation}`,
      });
      if (result.status === "rejected" || result.status === "failed") {
        return { kind: "failed", message: result.message };
      }
      entryIds.push(result.entryId);
      messages.push(result.message);
      await store.updateChange(item.id, { revertedById: result.entryId });
    }
    if (item.actor === "agent" || item.actor === "safety_net") {
      const action = item.action;
      if (action.type !== "ExternalChange") {
        await store.addUserDecision(input.businessId, { objectId: item.objectId, commandType: action.type, on: today });
      }
    }
  }
  return { kind: "done", entryIds, messages };
};

const AUTOMATED = new Set(["agent", "safety_net"]);
const OUTCOME_DELAY_DAYS = 7;

const rub = (kopecks: number | null): string =>
  kopecks === null ? "—" : `${Math.round(kopecks / 100).toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;

/** Fills «Что стало после» for automated changes made 7 days ago (change-history spec). */
export const recordOutcomes = async (ctx: JobContext, businessId: string): Promise<number> => {
  const { store } = ctx;
  const business = await store.getBusiness(businessId);
  const now = ctx.clock.now();
  const directions = await store.directions(businessId);
  const ads = await store.ads(businessId);
  let filled = 0;
  for (const entry of await store.changes(businessId)) {
    if (!AUTOMATED.has(entry.actor) || entry.status !== "applied" || entry.outcome !== null || entry.objectKind === "business") {
      continue;
    }
    if (now.getTime() - entry.createdAt.getTime() < OUTCOME_DELAY_DAYS * 86_400_000) {
      continue;
    }
    const directionId = entry.objectKind === "direction" ? entry.objectId : ads.find((a) => a.id === entry.objectId)?.directionId;
    const direction = directions.find((d) => d.id === directionId);
    if (!direction) {
      continue;
    }
    const changedOn = toLocalDate(entry.createdAt, business.timeZone);
    const rows = await store.stats(businessId, addDays(changedOn, -OUTCOME_DELAY_DAYS), addDays(changedOn, OUTCOME_DELAY_DAYS));
    const own = rows.filter((r) => r.campaignId === direction.platformCampaignId);
    const window = (from: string, to: string): PerformanceStats =>
      aggregate(own.filter((r) => r.date >= from && r.date <= to), () => "all").get("all") ?? { impressions: 0, clicks: 0, leads: 0, spend: 0 };
    const before = window(addDays(changedOn, -OUTCOME_DELAY_DAYS), addDays(changedOn, -1));
    const after = window(changedOn, addDays(changedOn, OUTCOME_DELAY_DAYS - 1));
    const outcome = `За неделю после изменения: обращений ${after.leads} (было ${before.leads}), стоимость обращения ${rub(costPerLead(after))} (было ${rub(costPerLead(before))})`;
    await store.updateChange(entry.id, { outcome });
    filled++;
  }
  return filled;
};
