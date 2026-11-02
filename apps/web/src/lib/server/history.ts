import "server-only";
import { ACTION_META, BUDGET_ADJUSTMENT_REASON, inverseCommands, isBudgetAdjustment } from "@impuls/worker";
import type { ChangeEntry } from "@impuls/worker";
import { describeDiff, objectName } from "../history-view";
import type { HistoryItem, Names } from "../history-view";
import { toInsightCard } from "../insights-model";
import { platformCapabilities } from "./read-context";
import { store } from "./runtime";

/** Why an entry has no «Вернуть как было» button, in plain words. */
const unavailableReason = (entry: ChangeEntry): string | null => {
  const meta = ACTION_META[entry.action.type];
  if (!meta.reversible) {
    return `Это нельзя вернуть: ${meta.irreversibleReason ?? "изменение необратимо"}.`;
  }
  if (entry.status !== "applied") {
    return entry.status === "pending" ? "Изменение ещё применяется." : "Изменение не применилось, возвращать нечего.";
  }
  if (entry.reasonCode === "LAUNCH") {
    return "Запуск нельзя отменить, но рекламу можно поставить на паузу в настройках.";
  }
  if (isBudgetAdjustment(entry)) {
    return `${BUDGET_ADJUSTMENT_REASON.charAt(0).toUpperCase()}${BUDGET_ADJUSTMENT_REASON.slice(1)}.`;
  }
  if (entry.reasonCode === "USER_BUDGET") {
    return "Бюджет меняется в настройках — укажите там нужную сумму.";
  }
  if (inverseCommands(entry) === null) {
    return "Это изменение нельзя вернуть отсюда.";
  }
  return null;
};

export const loadNames = async (businessId: string): Promise<Names> => {
  const [directions, ads, business] = await Promise.all([store().directions(businessId), store().ads(businessId), store().getBusiness(businessId)]);
  return {
    directions: Object.fromEntries(directions.map((d) => [d.id, d.name])),
    channels: Object.fromEntries(directions.map((d) => [d.id, d.channel])),
    ads: Object.fromEntries(ads.map((a) => [a.id, a.title])),
    strategies: Object.fromEntries(platformCapabilities(business.mode).strategies.map((s) => [s.id, s.title])),
  };
};

/** The history screen model (change-history spec): every logged change, newest first. */
export const buildHistory = async (businessId: string): Promise<{ items: HistoryItem[]; names: Names }> => {
  const [entries, names, insights] = await Promise.all([store().changes(businessId), loadNames(businessId), store().insights(businessId)]);
  const insightById = new Map(insights.map((i) => [i.id, i]));
  const items = entries
    .map((entry): HistoryItem => {
      const reason = entry.revertedById !== null ? "Уже отменено." : unavailableReason(entry);
      return {
        id: entry.id,
        at: entry.createdAt.toISOString(),
        author: entry.author,
        object: objectName(entry.objectKind, entry.objectId, names),
        diff: describeDiff(entry.before, entry.after, names),
        explanation: entry.explanation,
        outcome: entry.outcome,
        turnId: entry.turnId,
        // The entry has its own «Вернуть как было»: the card behind «Почему» has none.
        insight: entry.insightId ? ((r) => (r ? toInsightCard(r, null, null) : null))(insightById.get(entry.insightId)) : null,
        status: entry.status,
        reverted: entry.revertedById !== null,
        rollback: reason === null ? { kind: "available", consequences: ACTION_META[entry.action.type].rollbackConsequences } : { kind: "unavailable", reason },
        budgetAdjustment: isBudgetAdjustment(entry),
      };
    })
    .reverse();
  return { items, names };
};
