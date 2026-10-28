import "server-only";
import { ACTION_META, inverseCommands } from "@impuls/worker";
import type { ChangeEntry } from "@impuls/worker";
import { describeDiff, historyType, objectName } from "../history-view";
import type { HistoryItem, Names } from "../history-view";
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
  if (entry.reasonCode === "USER_BUDGET") {
    return "Бюджет меняется в настройках — укажите там нужную сумму.";
  }
  if (inverseCommands(entry) === null) {
    return "Это изменение нельзя вернуть отсюда.";
  }
  return null;
};

export const loadNames = async (businessId: string): Promise<Names> => {
  const [directions, ads] = await Promise.all([store().directions(businessId), store().ads(businessId)]);
  return {
    directions: Object.fromEntries(directions.map((d) => [d.id, d.name])),
    ads: Object.fromEntries(ads.map((a) => [a.id, a.title])),
    strategies: Object.fromEntries(platformCapabilities().strategies.map((s) => [s.id, s.title])),
  };
};

/** The history screen model (change-history spec): every logged change, newest first. */
export const buildHistory = async (businessId: string): Promise<{ items: HistoryItem[]; names: Names }> => {
  const [entries, names] = await Promise.all([store().changes(businessId), loadNames(businessId)]);
  const items = entries
    .map((entry): HistoryItem => {
      const reason = entry.revertedById !== null ? "Уже отменено." : unavailableReason(entry);
      return {
        id: entry.id,
        at: entry.createdAt.toISOString(),
        author: entry.author,
        type: historyType(entry.action.type, entry.reasonCode, entry.objectKind),
        object: objectName(entry.objectKind, entry.objectId, names),
        diff: describeDiff(entry.before, entry.after, names),
        explanation: entry.explanation,
        outcome: entry.outcome,
        status: entry.status,
        reverted: entry.revertedById !== null,
        rollback: reason === null ? { kind: "available", consequences: ACTION_META[entry.action.type].rollbackConsequences } : { kind: "unavailable", reason },
      };
    })
    .reverse();
  return { items, names };
};
