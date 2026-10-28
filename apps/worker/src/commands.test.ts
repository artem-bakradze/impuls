import { IdlePolicy } from "@impuls/agent";
import { rubles } from "@impuls/core";
import type { Command } from "@impuls/core";
import { describe, expect, it } from "vitest";
import { ACTION_META, rollback } from "./history";
import { SimulationDriver } from "./simulation";

const truth = { impressionsPerDay: 500, ctr: 0.05, cr: 0.05, costPerClick: rubles(25) };

const card = (price: number) =>
  JSON.stringify({
    businessName: "Салон «Ноготки»",
    phone: "+7 900 123-45-67",
    services: [{ name: "Маникюр с покрытием", price: rubles(price) }],
    photos: [],
    address: "Москва, Профсоюзная ул., 1",
    openingHours: [{ days: "Пн–Вс", hours: "10:00–22:00" }],
    messengers: { telegram: "nogotki_salon" },
  });

const world = async () => {
  const sim = new SimulationDriver({ start: new Date("2026-10-05T03:00:00Z"), seed: 1, agent: new IdlePolicy() });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: 30_000,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [
      { name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр 1 800 ₽ у метро", truth }, { title: "Маникюр", truth }] },
      { name: "Педикюр — Поиск", weeklyLimitRub: 1_500, ads: [{ title: "Педикюр", truth }] },
    ],
  });
  const business = await sim.store.getBusiness("b1");
  await sim.store.saveBusiness({ ...business, miniSite: { slug: "nogotki", card: card(1_800), metrikaCounterId: 12345678, advertiser: { name: "ИП Иванова", inn: "771234567890" } } });
  return sim;
};

const state = async (sim: SimulationDriver) => ({
  directions: (await sim.store.directions("b1")).map((d) => ({ status: d.status, weeklyLimit: d.weeklyLimit, strategyId: d.strategyId, schedule: d.schedule, geo: d.geoRadiusKm })),
  ads: (await sim.store.ads("b1")).map((a) => ({ status: a.status, title: a.title, text: a.text })),
  miniSite: (await sim.store.getBusiness("b1")).miniSite?.card,
});

const reversible: { name: string; prepare?: Command; command: Command }[] = [
  { name: "SetSpendLimit", command: { type: "SetSpendLimit", directionId: "b1-d1", weeklyLimit: rubles(1_200) } },
  { name: "SetStrategy", command: { type: "SetStrategy", directionId: "b1-d1", strategyId: "AVERAGE_CPA" } },
  { name: "PauseAd", command: { type: "PauseAd", adId: "b1-d1-a1" } },
  { name: "ResumeAd", prepare: { type: "PauseAd", adId: "b1-d1-a1" }, command: { type: "ResumeAd", adId: "b1-d1-a1" } },
  { name: "PauseDirection", command: { type: "PauseDirection", directionId: "b1-d2" } },
  { name: "ResumeDirection", prepare: { type: "PauseDirection", directionId: "b1-d2" }, command: { type: "ResumeDirection", directionId: "b1-d2" } },
  { name: "PauseAll", command: { type: "PauseAll" } },
  { name: "ResumeAll", prepare: { type: "PauseAll" }, command: { type: "ResumeAll" } },
  { name: "UpdateSchedule", command: { type: "UpdateSchedule", directionId: "b1-d1", schedule: "Пн–Пт 09:00–21:00" } },
  { name: "UpdateGeo", command: { type: "UpdateGeo", directionId: "b1-d1", radiusKm: 7 } },
  { name: "UpdateAdText", command: { type: "UpdateAdText", adId: "b1-d1-a2", title: "Маникюр за час", text: "Без очереди у метро" } },
  { name: "UpdateMiniSite", command: { type: "UpdateMiniSite", card: card(2_000) } },
];

const run = (sim: SimulationDriver, command: Command) =>
  sim.executor.execute({ businessId: "b1", command, actor: "user", reasonCode: "USER_CHANGE", explanation: "Вы изменили настройки" });

describe("MVP commands: command → rollback → original state", () => {
  it.each(reversible)("$name", async ({ command, prepare }) => {
    const sim = await world();
    if (prepare) {
      expect((await run(sim, prepare)).status).toBe("applied");
    }
    const original = await state(sim);
    const result = await run(sim, command);
    expect(result.status).toBe("applied");
    expect(await state(sim)).not.toEqual(original);
    const entry = (await sim.store.changes("b1")).at(-1);
    expect(ACTION_META[command.type].reversible).toBe(true);
    expect(ACTION_META[command.type].rollbackConsequences.length).toBeGreaterThan(0);
    expect((await rollback(sim.ctx, { businessId: "b1", entryId: entry?.id ?? "" })).kind).toBe("done");
    expect(await state(sim)).toEqual(original);
  });

  it("declares irreversible commands with a reason", () => {
    for (const type of ["StartExperiment", "FinishExperiment", "PublishMiniSite"] as const) {
      expect(ACTION_META[type].reversible).toBe(false);
      expect(ACTION_META[type].irreversibleReason).toBeTruthy();
    }
  });
});

describe("mini-site", () => {
  it("publishes statically and offers to update ads that still show the old price", async () => {
    const sim = await world();
    expect((await run(sim, { type: "PublishMiniSite" })).status).toBe("applied");
    expect(sim.miniSites.objects.get("nogotki/index.html")?.body.replace(/[\u00a0\u202f]/g, " ")).toContain("1 800");

    await run(sim, { type: "UpdateMiniSite", card: card(2_000) });
    expect(sim.miniSites.objects.get("nogotki/index.html")?.body.replace(/[\u00a0\u202f]/g, " ")).toContain("2 000");
    const notice = (await sim.store.notifications("b1")).find((n) => n.kind === "minisite_price_changed");
    expect(notice?.message).toBe("Цена «Маникюр с покрытием» теперь 2 000 ₽, а в объявлениях: «Маникюр 1 800 ₽ у метро» — ещё 1 800 ₽. Обновить объявления?");
    expect((await sim.store.changes("b1")).at(-1)).toMatchObject({ objectKind: "minisite", author: "user", status: "applied" });
  });

  it("is never changed by the agent", async () => {
    const sim = await world();
    const result = await sim.executor.execute({ businessId: "b1", command: { type: "PublishMiniSite" }, actor: "agent", reasonCode: "X", explanation: "Опубликовал" });
    expect(result).toMatchObject({ status: "rejected", code: "NOT_ALLOWED_FOR_AUTOMATION" });
  });
});
