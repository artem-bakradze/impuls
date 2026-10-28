import "server-only";
import type { SettingsModel } from "../settings-model";
import { parseSchedule } from "../settings-model";
import { readDraft } from "./business";
import type { BusinessRow } from "./business";
import { platformCapabilities } from "./read-context";
import { store } from "./runtime";

export const buildSettings = async (row: BusinessRow): Promise<SettingsModel> => {
  const s = store();
  const [business, directions, ads, approvals] = await Promise.all([s.getBusiness(row.id), s.directions(row.id), s.ads(row.id), s.approvals(row.id)]);
  const draft = readDraft(row);
  const strategies = new Map(platformCapabilities().strategies.map((st) => [st.id, st.title]));
  const names = new Map(directions.map((d) => [d.id, d.name]));
  const first = directions[0];
  return {
    timeZone: business.timeZone,
    card: { category: business.card.category, services: business.card.services, advantages: business.card.advantages },
    siteUrl: draft.sources.siteUrl === "" ? null : draft.sources.siteUrl,
    radiusKm: first?.geoRadiusKm ?? draft.card.radiusKm,
    schedule: parseSchedule(first?.schedule ?? business.card.hours),
    monthlyBudgetRub: business.monthlyBudgetRub,
    goal: business.csoSource.kind === "user" ? { mode: "user", rub: business.csoSource.goal / 100 } : { mode: "auto", rub: business.csoSource.reference / 100 },
    paused: directions.length > 0 && directions.every((d) => d.status === "paused"),
    autonomy: business.autonomy,
    ads: ads.map((a) => ({ id: a.id, title: a.title, text: a.text, status: a.status, moderation: a.moderation, direction: names.get(a.directionId) ?? "" })),
    directions: directions.map((d) => ({
      id: d.id,
      name: d.name,
      channel: d.channel,
      strategy: strategies.get(d.strategyId) ?? d.strategyId,
      weeklyLimit: d.weeklyLimit,
      status: d.status,
      schedule: d.schedule,
      radiusKm: d.geoRadiusKm,
    })),
    approvals: approvals
      .slice()
      .reverse()
      .map((a) => ({ id: a.id, explanation: a.explanation, status: a.status, at: a.createdAt.toISOString() })),
  };
};
