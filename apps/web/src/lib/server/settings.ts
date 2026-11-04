import "server-only";
import { loadBusinessView } from "@impuls/worker";
import { GOAL_OPTIONS } from "../onboarding";
import { measurementFromCard } from "../measurement";
import type { SettingsModel } from "../settings-model";
import { parseSchedule } from "../settings-model";
import { readDraft } from "./business";
import type { BusinessRow } from "./business";
import { businessClock, platformCapabilities, readOnlyContext } from "./read-context";
import { store, supportEmail } from "./runtime";

type Card = { businessName: string; phone: string; address: string; openingHours: { days: string; hours: string }[]; messengers: { telegram?: string }; services: { name: string; price: number }[] };

/** Mini-site form model: the published card, or a prefill from the wizard card. */
const miniSiteModel = (business: Awaited<ReturnType<ReturnType<typeof store>["getBusiness"]>>, draft: ReturnType<typeof readDraft>): SettingsModel["miniSite"] => {
  const site = business.miniSite;
  if (site) {
    const card = JSON.parse(site.card) as Card;
    return {
      published: true,
      slug: site.slug,
      businessName: card.businessName,
      phone: card.phone,
      address: card.address,
      hours: card.openingHours.map((h) => `${h.days} ${h.hours}`).join(", "),
      telegram: card.messengers.telegram ?? "",
      metrikaCounterId: site.metrikaCounterId,
      advertiserName: site.advertiser.name,
      advertiserInn: site.advertiser.inn,
      services: card.services.map((sv) => ({ name: sv.name, priceRub: Math.round(sv.price / 100) })),
    };
  }
  return {
    published: false,
    slug: "",
    businessName: draft.card.name,
    phone: draft.card.phone,
    address: draft.card.address,
    hours: business.card.hours,
    telegram: "",
    metrikaCounterId: null,
    advertiserName: "",
    advertiserInn: "",
    services: business.card.services.filter((sv) => sv.priceRub !== null).map((sv) => ({ name: sv.name, priceRub: sv.priceRub ?? 0 })),
  };
};

export const buildSettings = async (row: BusinessRow): Promise<SettingsModel> => {
  const s = store();
  const [business, directions, ads] = await Promise.all([s.getBusiness(row.id), s.directions(row.id), s.ads(row.id)]);
  // The same goal the main screen shows: the reference until the automatic goal is refined, then the refined one.
  const view = await loadBusinessView(s, row.id, readOnlyContext(await businessClock(row.id)).clock, platformCapabilities(business.mode));
  const draft = readDraft(row);
  const names = new Map(directions.map((d) => [d.id, d.name]));
  const first = directions[0];
  return {
    timeZone: business.timeZone,
    measurement: measurementFromCard(business.card, business.mode === "simulation"),
    card: { category: business.card.category, services: business.card.services, advantages: business.card.advantages },
    siteUrl: draft.sources.siteUrl === "" ? null : draft.sources.siteUrl,
    miniSite: miniSiteModel(business, draft),
    city: first?.city || draft.card.city,
    schedule: parseSchedule(first?.schedule ?? business.card.hours),
    monthlyBudgetRub: business.monthlyBudgetRub,
    goal:
      business.csoSource.kind === "user"
        ? { mode: "user", rub: business.csoSource.goal / 100, learned: false }
        : { mode: "auto", rub: Math.floor(view.cso / 100), learned: view.cso !== business.csoSource.reference },
    paused: directions.length > 0 && directions.every((d) => d.status === "paused"),
    supportEmail: supportEmail(),
    ads: ads.map((a) => ({ id: a.id, title: a.title, text: a.text, status: a.status, moderation: a.moderation, direction: names.get(a.directionId) ?? "" })),
    goals: GOAL_OPTIONS.filter((g) => draft.goals.includes(g.value)).map((g) => g.label),
  };
};
