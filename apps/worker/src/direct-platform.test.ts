import { describe, expect, it } from "vitest";
import { BusinessDirectPlatform } from "./direct-platform";

const campaign = {
  Id: 101,
  Name: "[Импульс] Маникюр — Поиск",
  State: "ON",
  Status: "ACCEPTED",
  TextCampaign: {
    BiddingStrategy: { Search: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 300_000_000 } }, Network: { BiddingStrategyType: "SERVING_OFF" } },
    Settings: [],
  },
};

describe("BusinessDirectPlatform", () => {
  it("calls the production API with the business's own token, loading it once", async () => {
    const loaded: string[] = [];
    const auth: string[] = [];
    const logged: unknown[] = [];
    const platform = new BusinessDirectPlatform(
      "b1",
      (businessId) => {
        loaded.push(businessId);
        return Promise.resolve("y0_owner-token");
      },
      (entry) => logged.push(entry),
      (input, init) => {
        auth.push(`${input instanceof Request ? input.url : String(input)} ${(init?.headers as Record<string, string>).Authorization}`);
        return Promise.resolve(new Response(JSON.stringify({ result: { Campaigns: [campaign] } })));
      },
    );
    await platform.getCampaigns(["101"]);
    await platform.getCampaigns(["101"]);
    expect(loaded).toEqual(["b1"]);
    expect(auth).toEqual(Array(2).fill("https://api.direct.yandex.com/json/v5/campaigns Bearer y0_owner-token"));
    expect(logged[0]).toMatchObject({ businessId: "b1", service: "campaigns", method: "get", outcome: "ok" });
    expect(JSON.stringify(logged)).not.toContain("y0_owner-token");
  });

  it("fails explicitly when the business has no connected account", async () => {
    const platform = new BusinessDirectPlatform("b1", () => Promise.resolve(null), () => undefined);
    await expect(platform.getCampaigns(["101"])).rejects.toMatchObject({ code: "DIRECT_NOT_CONNECTED" });
    expect(platform.capabilities().platform).toBe("yandex-direct");
  });
});
