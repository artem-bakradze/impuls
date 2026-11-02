import { addDays, analystDecisionKey, costPerLead, toLocalDate } from "@impuls/core";
import type { Command, PerformanceStats, UserDecision } from "@impuls/core";
import { ADJUSTABLE_DEVICES, TRAFFIC_KEYS, adjustmentKey, normalizePhrase, phrasesMissing, snapshotPhrases } from "./analyst";
import { BUDGET_ADJUSTMENT_REASON, isBudgetAdjustment } from "./change-kinds";
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
  UpdateGeo: { reversible: true, rollbackConsequences: ["реклама снова будет показываться в прежнем городе"] },
  SetGoal: { reversible: true, rollbackConsequences: ["вернётся прежняя цель по цене обращения"] },
  UpdateCard: { reversible: true, rollbackConsequences: ["вернётся прежнее описание услуг, цен и преимуществ", "тексты объявлений не изменятся"] },
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
  AddNegativeKeywords: { reversible: true, rollbackConsequences: ["реклама снова будет показываться по этим запросам", "минус-фразы других изменений останутся", KEEPS_STATS] },
  RemoveNegativeKeywords: { reversible: true, rollbackConsequences: ["реклама снова перестанет показываться по этим запросам", KEEPS_STATS] },
  SetDeviceAdjustment: { reversible: true, rollbackConsequences: ["вернётся прежняя цена перехода с этого устройства", KEEPS_STATS] },
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
  if (entry.objectKind === "goal") {
    const value = Number(before.csoValue);
    return [{ type: "SetGoal", source: before.csoMode === "user" ? { kind: "user", goal: value } : { kind: "auto", reference: value } }];
  }
  if (entry.objectKind === "card") {
    return [
      {
        type: "UpdateCard",
        card: {
          category: String(before.category),
          services: JSON.parse(String(before.services)) as { name: string; priceRub: number | null }[],
          advantages: JSON.parse(String(before.advantages)) as string[],
        },
      },
    ];
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
  if ("city" in before && before.city !== after.city) {
    commands.push({ type: "UpdateGeo", directionId, city: String(before.city) });
  }
  // Negative phrases: exactly the phrases this entry added or removed, so other entries' phrases stay.
  if ("negativeKeywords" in before && before.negativeKeywords !== after.negativeKeywords) {
    const was = snapshotPhrases(before);
    const now = snapshotPhrases(after);
    const added = phrasesMissing(now, was);
    const removed = phrasesMissing(was, now);
    if (added.length > 0) commands.push({ type: "RemoveNegativeKeywords", directionId, phrases: added });
    if (removed.length > 0) commands.push({ type: "AddNegativeKeywords", directionId, phrases: removed });
  }
  for (const device of ADJUSTABLE_DEVICES) {
    const key = adjustmentKey(device);
    if (key in before && before[key] !== after[key]) {
      commands.push({ type: "SetDeviceAdjustment", directionId, device, percent: Number(before[key]) });
    }
  }
  return commands;
};

/**
 * What an entry changed: each negative phrase and each device adjustment on its own, everything else as the object's
 * settings. Later entries join a rollback chain only when they changed the same thing (change-history spec «Откат
 * одной минус-фразы»), so earlier commands keep chaining as before.
 */
const touches = (entry: ChangeEntry): Set<string> => {
  const { before, after } = entry;
  const keys = new Set<string>();
  if ("negativeKeywords" in before && before.negativeKeywords !== after.negativeKeywords) {
    const was = snapshotPhrases(before);
    const now = snapshotPhrases(after);
    for (const phrase of [...phrasesMissing(now, was), ...phrasesMissing(was, now)]) keys.add(`negative:${normalizePhrase(phrase)}`);
  }
  for (const device of ADJUSTABLE_DEVICES) {
    const key = adjustmentKey(device);
    if (key in before && before[key] !== after[key]) keys.add(key);
  }
  const otherChanged = Object.keys(before).some((k) => !TRAFFIC_KEYS.includes(k) && before[k] !== after[k]);
  if (keys.size === 0 || otherChanged) keys.add("settings");
  return keys;
};

const overlaps = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => [...a].some((key) => b.has(key));

/**
 * The owner's decisions a rollback of an automated entry records: per phrase and per device for the analyst levers, so
 * the agent keeps away from exactly what the owner returned for 14 days.
 */
const userDecisionsOf = (item: ChangeEntry, on: string): UserDecision[] => {
  const action = item.action;
  switch (action.type) {
    case "ExternalChange":
      return [];
    case "AddNegativeKeywords":
      return action.phrases.map((p) => ({ objectId: analystDecisionKey(item.objectId, normalizePhrase(p)), commandType: action.type, on }));
    case "SetDeviceAdjustment":
      return [{ objectId: analystDecisionKey(item.objectId, action.device), commandType: action.type, on }];
    default:
      return [{ objectId: item.objectId, commandType: action.type, on }];
  }
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
  // Undoing a cut to the month's remainder would only go over the budget (change-history spec «Подстройка лимита»).
  if (isBudgetAdjustment(entry)) {
    return { kind: "not_reversible", reason: BUDGET_ADJUSTMENT_REASON };
  }
  // The journal is ordered; position (not timestamp) decides what is later, since timestamps can tie.
  const touched = touches(entry);
  const later = all
    .slice(all.indexOf(entry) + 1)
    .filter(
      (c) => c.objectId === entry.objectId && c.status === "applied" && c.revertedById === null && c.reasonCode !== "USER_ROLLBACK" && overlaps(touches(c), touched),
    );
  // A limit cut later only by the budget guard: undoing the cuts would go over the budget, so the earlier limit is set
  // right away when it is not above the current one (change-history spec «Откат прибавки бюджета после подрезаний»).
  // Only later changes of the same limit matter here: e.g. a check started in this advertising leaves the limit alone.
  const laterLimitChanges = later.filter((c) => c.before.weeklyLimit !== c.after.weeklyLimit);
  if (
    entry.action.type === "SetSpendLimit" &&
    later.length > 0 &&
    laterLimitChanges.every((c) => c.actor === "budget_guard" && c.action.type === "SetSpendLimit")
  ) {
    const direction = (await store.directions(input.businessId)).find((d) => d.id === entry.objectId);
    const target = Number(entry.before.weeklyLimit);
    if (direction && target <= direction.weeklyLimit) {
      const result = await ctx.executor.execute({
        businessId: input.businessId,
        command: { type: "SetSpendLimit", directionId: direction.id, weeklyLimit: target },
        actor: "user",
        reasonCode: "USER_ROLLBACK",
        explanation: `Вы отменили изменение: ${entry.explanation}`,
      });
      if (result.status === "rejected" || result.status === "failed") {
        return { kind: "failed", message: result.message };
      }
      await store.updateChange(entry.id, { revertedById: result.entryId });
      if (entry.actor === "agent" || entry.actor === "safety_net") {
        const today = toLocalDate(ctx.clock.now(), (await store.getBusiness(input.businessId)).timeZone);
        await store.addUserDecision(input.businessId, { objectId: entry.objectId, commandType: entry.action.type, on: today });
      }
      return { kind: "done", entryIds: [result.entryId], messages: [result.message] };
    }
  }
  if (later.length > 0 && input.includeLater !== true) {
    return { kind: "needs_chain", later };
  }
  const chain = [...later].reverse();
  chain.push(entry);
  if (chain.some((c) => !ACTION_META[c.action.type].reversible)) {
    return { kind: "not_reversible", reason: "в цепочке есть изменение, которое нельзя отменить" };
  }

  const newest = chain[0] ?? entry;
  const withTraffic = TRAFFIC_KEYS.some((k) => k in newest.after);
  const actual = await ctx.executor.currentPlatformSnapshot(input.businessId, newest.objectKind, newest.objectId, withTraffic);
  // Only what the chain changed is compared: a later change of another phrase or of the limit is not a difference.
  const changed = new Set(chain.flatMap((c) => [...touches(c)]));
  const keys = Object.keys(actual).filter((k) =>
    k === "negativeKeywords" ? [...changed].some((t) => t.startsWith("negative:")) : TRAFFIC_KEYS.includes(k) ? changed.has(k) : changed.has("settings"),
  );
  const phrases = [...changed].filter((t) => t.startsWith("negative:")).map((t) => t.slice("negative:".length));
  const has = (snapshot: Snapshot) => new Set(snapshotPhrases(snapshot).map(normalizePhrase));
  const phrasesSame = !keys.includes("negativeKeywords") || phrases.every((p) => has(newest.after).has(p) === has(actual).has(p));
  if (!sameOn(newest.after, actual, keys.filter((k) => k !== "negativeKeywords")) || !phrasesSame) {
    if (input.confirmDifference !== true) {
      return { kind: "state_differs", expected: pickFields(newest.after, keys), actual: pickFields(actual, keys) };
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
      for (const decision of userDecisionsOf(item, today)) {
        await store.addUserDecision(input.businessId, decision);
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
