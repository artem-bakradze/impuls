import type { DAY_OPTIONS } from "./onboarding";

import type { MeasurementModel } from "./measurement";

export interface SettingsModel {
  measurement?: MeasurementModel;
  timeZone: string;
  card: { category: string; services: { name: string; priceRub: number | null }[]; advantages: string[] };
  siteUrl: string | null;
  /** Published mini-site, or the card data to prefill its form when the business has no own site. */
  miniSite: { published: boolean; slug: string; businessName: string; phone: string; address: string; hours: string; telegram: string; metrikaCounterId: number | null; advertiserName: string; advertiserInn: string; services: { name: string; priceRub: number }[] };
  city: string;
  schedule: { raw: string; days: (typeof DAY_OPTIONS)[number]; from: string; to: string } | { raw: string; days: null; from: null; to: null };
  monthlyBudgetRub: number;
  /** For the automatic goal, `rub` is the reference until it is refined by own leads (`learned`), then the refined goal. */
  goal: { mode: "user" | "auto"; rub: number; learned: boolean };
  paused: boolean;
  /** Where the owner asks to delete the account (auth spec: deletion by request to support). */
  supportEmail: string;
  ads: { id: string; title: string; text: string; status: "active" | "paused"; moderation: "accepted" | "pending" | "rejected"; direction: string }[];
  /** What counts as a lead, chosen at launch; shown, not edited (business-onboarding «Определение клиента»). */
  goals: string[];
}

const SCHEDULE = /^(Пн–Вс|Пн–Пт|Пн–Сб|Вт–Вс) (\d{2}:00)–(\d{2}:00)$/;

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
