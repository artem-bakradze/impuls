import type { Kopecks } from "@impuls/core";
import { formatRub } from "./format";

export type SummaryPeriod = "week" | "month";

export interface Compared<T> {
  value: T;
  previous: T;
}

export interface SummaryModel {
  timeZone: string;
  period: SummaryPeriod;
  /** first_day: no statistics yet, show the launch state instead of zeros. */
  state: "first_day" | "running" | "paused";
  moderation: { pending: number; accepted: number; rejected: number };
  monthBudget: Kopecks;
  spentMonth: Kopecks;
  spend: Compared<Kopecks>;
  leads: Compared<number>;
  clients: Compared<number | null>;
  clientCost:
    | { kind: "known"; costPerClient: Kopecks | null; clients: number; week: string }
    | { kind: "unknown"; costPerLead: Kopecks | null; hint: string; week: string };
  goal: { mode: "user" | "auto"; cso: Kopecks; current: Kopecks | null; status: "within" | "above" | "no_data" };
  actions: { id: string; at: string; text: string }[];
  attention: {
    notifications: { id: string; kind: string; message: string; at: string }[];
    approvals: { id: string; explanation: string; at: string }[];
    clientsQuestion: { week: string; weekEnd: string; leads: number } | null;
  };
  directions: {
    id: string;
    name: string;
    channel: "search" | "network";
    status: "active" | "paused";
    spend: Kopecks;
    leads: number;
    costPerLead: Kopecks | null;
  }[];
}

/** «Цель: до M ₽ за обращение · Сейчас: X ₽ — дороже цели» (analytics spec). */
export const goalLine = (goal: SummaryModel["goal"]): string => {
  const target = goal.mode === "user" ? `Цель: до ${formatRub(goal.cso)} за обращение` : `Цель: подбираем сами, сейчас до ${formatRub(goal.cso)} за обращение`;
  if (goal.current === null) {
    return `${target} · Сейчас: обращений пока нет`;
  }
  return `${target} · Сейчас: ${formatRub(goal.current)} — ${goal.status === "within" ? "в цели" : "дороже цели"}`;
};

/** Comparison with the previous period in plain words. */
export const compareText = (value: number, previous: number, format: (n: number) => string): string => {
  if (value === previous) {
    return "как в прошлом периоде";
  }
  const diff = value - previous;
  return `${diff > 0 ? "больше" : "меньше"} на ${format(Math.abs(diff))}, чем в прошлом периоде`;
};

export const channelLabel = (channel: "search" | "network"): string => (channel === "search" ? "Поиск Яндекса" : "Сайты-партнёры Яндекса");

export const moderationText = (m: SummaryModel["moderation"]): string => {
  if (m.pending > 0) {
    return "Яндекс проверяет объявления, обычно это занимает несколько часов";
  }
  if (m.rejected > 0 && m.accepted === 0) {
    return "Яндекс не пропустил объявления — мы готовим исправленные варианты";
  }
  return "Объявления прошли проверку Яндекса";
};
