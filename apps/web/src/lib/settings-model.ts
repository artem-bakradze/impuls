import type { DAY_OPTIONS } from "./onboarding";

export interface SettingsModel {
  timeZone: string;
  card: { category: string; services: { name: string; priceRub: number | null }[]; advantages: string[] };
  siteUrl: string | null;
  /** Published mini-site, or the card data to prefill its form when the business has no own site. */
  miniSite: { published: boolean; slug: string; businessName: string; phone: string; address: string; hours: string; telegram: string; metrikaCounterId: number | null; advertiserName: string; advertiserInn: string; services: { name: string; priceRub: number }[] };
  radiusKm: number;
  schedule: { raw: string; days: (typeof DAY_OPTIONS)[number]; from: string; to: string } | { raw: string; days: null; from: null; to: null };
  monthlyBudgetRub: number;
  goal: { mode: "user" | "auto"; rub: number };
  paused: boolean;
  autonomy: "auto" | "ask";
  ads: { id: string; title: string; text: string; status: "active" | "paused"; moderation: "accepted" | "pending" | "rejected"; direction: string }[];
  directions: { id: string; name: string; channel: "search" | "network"; strategy: string; weeklyLimit: number; status: "active" | "paused"; schedule: string; radiusKm: number }[];
  approvals: { id: string; explanation: string; status: "pending" | "approved" | "declined" | "expired"; at: string }[];
}

const SCHEDULE = /^(Пн–Вс|Пн–Пт|Пн–Сб) (\d{2}:00)–(\d{2}:00)$/;

/** Parses the display schedule the wizard writes («Пн–Вс 10:00–20:00»); other formats are shown as text only. */
export const parseSchedule = (raw: string): SettingsModel["schedule"] => {
  const match = SCHEDULE.exec(raw);
  if (!match) {
    return { raw, days: null, from: null, to: null };
  }
  return { raw, days: match[1] as (typeof DAY_OPTIONS)[number], from: match[2] ?? "", to: match[3] ?? "" };
};

export const MODERATION_WORDS: Record<SettingsModel["ads"][number]["moderation"], string> = {
  accepted: "Яндекс одобрил",
  pending: "Яндекс проверяет",
  rejected: "Яндекс не пропустил",
};

export const APPROVAL_WORDS: Record<SettingsModel["approvals"][number]["status"], string> = {
  pending: "Ждёт вашего ответа",
  approved: "Вы согласились",
  declined: "Вы отказались",
  expired: "Истёк — вы не ответили за 48 часов",
};
