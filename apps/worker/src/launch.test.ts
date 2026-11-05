import { IdlePolicy, QuietPolicy } from "@impuls/agent";
import { PlatformError } from "@impuls/platforms";
import { describe, expect, it } from "vitest";
import { handleWebJob } from "./web-jobs";
import { CommandExecutor } from "./executor";
import { LaunchError } from "./launch";
import { SimulationDriver } from "./simulation";

describe("launch from the wizard", () => {
  it("creates one campaign per direction with site monitoring, logs «Реклама запущена» and queues a launch turn", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-28T09:00:00Z"), seed: 1, agent: new QuietPolicy() });
    await sim.store.saveBusiness({
      id: "b1",
      userId: "u1",
      timeZone: "Europe/Moscow",
      monthlyBudgetRub: 15_000,
      launchedOn: null,
      csoSource: { kind: "user", goal: 30_000 },
      miniSite: null,
      leadGoalId: null,
      mode: "direct",
      card: { category: "Маникюр", services: [{ name: "Маникюр", priceRub: 1_800 }], area: "м. Профсоюзная", hours: "Пн–Вс 10:00–22:00", advantages: [], name: "Ноготок", address: "Москва, ул. Профсоюзная, 1", city: "Москва", siteUrl: "https://nogotok.example/" },
    });
    const plan = {
      landingUrl: "https://nogotok.example/",
      city: "Москва",
      directions: [
        {
          name: "Маникюр — Поиск",
          channel: "search" as const,
          weeklyLimitRub: 1_500,
          keywords: ["маникюр", "маникюр москва"],
          negativeKeywords: ["обучение", "вакансии"],
          ads: [{ title: "Маникюр у метро", text: "Маникюр с покрытием за 1 800 ₽" }],
        },
        { name: "Маникюр — Сайты-партнёры", channel: "network" as const, weeklyLimitRub: 1_000, keywords: [], negativeKeywords: [], ads: [{ title: "Маникюр рядом", text: "Работаем до 22:00" }] },
      ],
    };
    sim.platform.failNextCampaignCreation(new PlatformError("ADVERTISER_DATA_REQUIRED", "Необходимо заполнить данные рекламодателя", false));
    expect(await handleWebJob(sim.ctx, { kind: "launch", businessId: "b1", plan })).toEqual({ status: "needs_advertiser_data", message: "Яндексу нужны данные о вашем бизнесе для маркировки рекламы" });
    expect(await sim.store.directions("b1")).toHaveLength(0);

    const result = (await handleWebJob(sim.ctx, { kind: "launch", businessId: "b1", plan })) as { directionIds: string[] };
    expect(result.directionIds).toHaveLength(2);
    const campaigns = await sim.platform.getCampaigns((await sim.store.directions("b1")).map((d) => d.platformCampaignId));
    expect(campaigns.every((c) => c.siteMonitoring && c.name.startsWith("[Импульс] "))).toBe(true);
    expect((await sim.store.getBusiness("b1")).launchedOn).toBe("2026-10-28");
    expect((await sim.store.changes("b1")).at(-1)?.explanation).toMatch(/^Реклама запущена\./);
    expect((await sim.store.pendingInbox("b1")).map((e) => e.trigger.kind)).toEqual(["launch"]);
    await expect(handleWebJob(sim.ctx, { kind: "launch", businessId: "b1", plan })).rejects.toBeInstanceOf(LaunchError);
  });

  it("refuses a search direction without phrases before creating anything", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-28T09:00:00Z"), seed: 1, agent: new IdlePolicy() });
    const business = await sim.launchBusiness({ id: "b2", monthlyBudgetRub: 15_000, launchedOn: "2026-10-01", csoSource: { kind: "user", goal: 30_000 }, directions: [] });
    await sim.store.saveBusiness({ ...business, launchedOn: null });
    const plan = {
      landingUrl: "https://nogotok.example/",
      city: "Москва",
      directions: [{ name: "Маникюр — Поиск", channel: "search" as const, weeklyLimitRub: 1_500, keywords: [], negativeKeywords: [], ads: [{ title: "t", text: "x" }] }],
    };
    await expect(handleWebJob(sim.ctx, { kind: "launch", businessId: "b2", plan })).rejects.toMatchObject({
      code: "NO_KEYWORDS",
      message: "Не получилось подобрать поисковые запросы для этой услуги — уточните описание услуги",
    });
    expect(await sim.store.directions("b2")).toHaveLength(0);
  });
});

describe("pictures at launch (platform-integration «Картинки в Директе»)", () => {
  const setup = async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-28T09:00:00Z"), seed: 1, agent: new IdlePolicy() });
    await sim.store.saveBusiness({
      id: "b1",
      userId: "u1",
      timeZone: "Europe/Moscow",
      monthlyBudgetRub: 15_000,
      launchedOn: null,
      csoSource: { kind: "user", goal: 30_000 },
      miniSite: null,
      leadGoalId: null,
      mode: "direct",
      card: { category: "Маникюр", services: [{ name: "Маникюр", priceRub: 1_800 }], area: "", hours: "Пн–Вс 10:00–22:00", advantages: [], name: "Ноготок", address: "", city: "Москва", siteUrl: "https://nogotok.example/" },
    });
    const picture = { businessId: "b1", png: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1), width: 1024, height: 1024, source: "template" as const, seed: 1, createdAt: new Date("2026-10-28T09:00:00Z") };
    await sim.store.saveAdImage({ ...picture, id: "img-1" });
    await sim.store.saveAdImage({ ...picture, id: "img-2", png: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 2) });
    await sim.store.saveAdImage({ ...picture, id: "img-foreign", businessId: "b9" });
    const uploads: string[] = [];
    let refuse = false;
    const platform = new Proxy(sim.platform, {
      get(target, property, receiver) {
        if (property === "uploadImage") {
          return (png: Uint8Array, name: string) => {
            uploads.push(name);
            return refuse ? Promise.reject(new PlatformError("DIRECT_ERROR_5004", "Неверный формат изображения", false)) : target.uploadImage(png, name);
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const ctx = { ...sim.ctx, platformFor: () => platform };
    const plan = (network: { title: string; text: string; imageId?: string }[]) => ({
      landingUrl: "https://nogotok.example/",
      city: "Москва",
      directions: [
        { name: "Маникюр — Поиск", channel: "search" as const, weeklyLimitRub: 1_500, keywords: ["маникюр"], negativeKeywords: [], ads: [{ title: "Маникюр у метро", text: "Маникюр за 1 800 ₽" }] },
        { name: "Маникюр — Сайты-партнёры", channel: "network" as const, weeklyLimitRub: 1_000, keywords: [], negativeKeywords: [], ads: network },
      ],
    });
    return { sim, ctx, uploads, plan, refuse: () => (refuse = true) };
  };

  it("uploads each picture once and creates the partner-site ads with them; search ads have none", async () => {
    const { sim, ctx, uploads, plan } = await setup();
    await handleWebJob(ctx, { kind: "launch", businessId: "b1", plan: plan([{ title: "Маникюр рядом", text: "До 22:00", imageId: "img-1" }, { title: "Маникюр у дома", text: "Без записи", imageId: "img-2" }]) });
    expect(uploads).toEqual(["Маникюр рядом", "Маникюр у дома"]);
    const ads = await sim.store.ads("b1");
    const network = ads.filter((a) => a.title !== "Маникюр у метро");
    expect(network.map((a) => a.imageId)).toEqual(["img-1", "img-2"]);
    expect(network.every((a) => typeof a.imageHash === "string")).toBe(true);
    expect(network[0]?.imageHash).not.toBe(network[1]?.imageHash);
    const platformAds = await sim.platform.getAds((await sim.store.directions("b1")).map((d) => d.platformCampaignId));
    expect(platformAds.filter((a) => a.imageHash !== null).map((a) => a.imageHash)).toEqual(network.map((a) => a.imageHash));
    expect(ads.find((a) => a.title === "Маникюр у метро")).toMatchObject({ imageId: null, imageHash: null });
  });

  it("draws its own picture for an ad without one or with another business's picture", async () => {
    const { sim, ctx, plan } = await setup();
    await handleWebJob(ctx, { kind: "launch", businessId: "b1", plan: plan([{ title: "Маникюр рядом", text: "До 22:00" }, { title: "Маникюр у дома", text: "Без записи", imageId: "img-foreign" }]) });
    const network = (await sim.store.ads("b1")).filter((a) => a.title !== "Маникюр у метро");
    expect(network.every((a) => a.imageId !== null && a.imageId !== "img-foreign" && a.imageHash !== null)).toBe(true);
    for (const ad of network) {
      expect((await sim.store.adImage(ad.imageId ?? ""))?.businessId).toBe("b1");
    }
  });

  it("stops the launch with a plain message before anything is created when the picture is refused", async () => {
    const { sim, ctx, plan, refuse } = await setup();
    refuse();
    await expect(handleWebJob(ctx, { kind: "launch", businessId: "b1", plan: plan([{ title: "Маникюр рядом", text: "До 22:00", imageId: "img-1" }]) })).rejects.toMatchObject({
      code: "IMAGE_UPLOAD_FAILED",
      message: "Яндекс не принял картинку объявления, поэтому реклама не запущена. Попробуйте ещё раз через несколько минут",
    });
    expect(await sim.store.directions("b1")).toHaveLength(0);
    expect((await sim.store.getBusiness("b1")).launchedOn).toBeNull();
  });

  it("gives a check's variant the original's picture without uploading it again", async () => {
    const { sim, ctx, uploads, plan } = await setup();
    await handleWebJob(ctx, { kind: "launch", businessId: "b1", plan: plan([{ title: "Маникюр рядом", text: "До 22:00", imageId: "img-1" }]) });
    const original = (await sim.store.ads("b1")).find((a) => a.imageId === "img-1");
    if (!original) throw new Error("no partner-site ad");
    const executor = new CommandExecutor({ store: sim.store, locks: sim.ctx.locks, clock: sim.ctx.clock, platformFor: ctx.platformFor });
    const result = await executor.execute({
      businessId: "b1",
      command: { type: "StartExperiment", directionId: original.directionId, adId: original.id, kind: "offer", hypothesis: "Проверяем оффер", variant: { title: "Маникюр рядом", text: "Первый визит −15%" } },
      actor: "safety_net",
      reasonCode: "SAFETY_START_EXPERIMENT",
      explanation: "Запустил проверку",
    });
    expect(result.status).toBe("applied");
    const variant = (await sim.store.ads("b1")).find((a) => a.text === "Первый визит −15%");
    expect(variant).toMatchObject({ imageId: "img-1", imageHash: original.imageHash });
    expect(uploads).toHaveLength(1);
  });
});
