import { IdlePolicy } from "@impuls/agent";
import { PlatformError } from "@impuls/platforms";
import { describe, expect, it } from "vitest";
import { handleWebJob } from "./web-jobs";
import { LaunchError } from "./launch";
import { SimulationDriver } from "./simulation";

describe("launch from the wizard", () => {
  it("creates one campaign per direction with site monitoring, logs «Реклама запущена» and queues a launch turn", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-28T09:00:00Z"), seed: 1, agent: new IdlePolicy() });
    await sim.store.saveBusiness({
      id: "b1",
      userId: "u1",
      timeZone: "Europe/Moscow",
      monthlyBudgetRub: 15_000,
      launchedOn: null,
      csoSource: { kind: "user", goal: 30_000 },
      autonomy: "auto",
      miniSite: null,
      weeklySummaryEnabled: true,
      card: { category: "Маникюр", services: [{ name: "Маникюр", priceRub: 1_800 }], area: "м. Профсоюзная", hours: "Пн–Вс 10:00–22:00", advantages: [] },
    });
    const plan = {
      directions: [
        { name: "Маникюр — Поиск", channel: "search" as const, weeklyLimitRub: 1_500, ads: [{ title: "Маникюр у метро", text: "Маникюр с покрытием за 1 800 ₽" }] },
        { name: "Маникюр — Сайты-партнёры", channel: "network" as const, weeklyLimitRub: 1_000, ads: [{ title: "Маникюр рядом", text: "Работаем до 22:00" }] },
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
});
