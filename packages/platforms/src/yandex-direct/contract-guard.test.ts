import { describe, expect, it } from "vitest";
import { CONTRACT_PREFIX, ContractGuard, ContractGuardError, preflightContractAccount } from "./contract-guard";
import { YandexDirectPlatform } from "./platform";

const result = (value: unknown): Response => new Response(JSON.stringify({ result: value }));

/** A platform over a fake Direct that answers from a queue and records the methods actually sent. */
const setup = (answers: unknown[]) => {
  const sent: string[] = [];
  const guard = new ContractGuard();
  const platform = new YandexDirectPlatform({
    token: "t",
    submitAdsForModeration: false,
    logger: () => undefined,
    guard,
    fetch: (input, init) => {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { method: string };
      sent.push(`${(input instanceof Request ? input.url : String(input)).split("/").pop() ?? ""}.${body.method}`);
      const answer = answers.shift();
      if (answer instanceof Response) {
        return Promise.resolve(answer);
      }
      return Promise.resolve(result(answer));
    },
  });
  return { platform, guard, sent };
};

const blocked = async (promise: Promise<unknown>): Promise<void> => {
  await expect(promise).rejects.toBeInstanceOf(ContractGuardError);
};

describe("ContractGuard", () => {
  it("refuses campaigns without the reserved prefix before sending", async () => {
    const { platform, sent } = setup([]);
    await blocked(platform.client.call("campaigns", "add", { Campaigns: [{ Name: "[Импульс] Маникюр" }] }, false));
    expect(sent).toEqual([]);
  });

  it("uploads only pictures named with the reserved prefix", async () => {
    const { platform, sent } = setup([{ AddResults: [{ AdImageHash: "h1" }] }]);
    await blocked(platform.uploadImage(Uint8Array.of(1, 2), "Маникюр"));
    expect(sent).toEqual([]);
    expect(await platform.uploadImage(Uint8Array.of(1, 2), `${CONTRACT_PREFIX}picture`)).toBe("h1");
    expect(sent).toEqual(["adimages.add"]);
  });

  it("refuses to touch a campaign the run did not create", async () => {
    const { platform, sent } = setup([]);
    await blocked(platform.updateCampaign("555", { status: "paused" }));
    await blocked(platform.client.call("campaigns", "delete", { SelectionCriteria: { Ids: [555] } }, false));
    await blocked(platform.client.call("ads", "suspend", { SelectionCriteria: { Ids: [777] } }, false));
    expect(sent).toEqual([]);
  });

  it("never sends anything to moderation and refuses unknown methods", async () => {
    const { platform, sent } = setup([]);
    await blocked(platform.client.call("ads", "moderate", { SelectionCriteria: { Ids: [1] } }, false));
    await blocked(platform.client.call("campaigns", "archive", { SelectionCriteria: { Ids: [1] } }, false));
    await blocked(platform.client.call("bids", "set", {}, false));
    expect(sent).toEqual([]);
  });

  it("refuses mass operations without explicit ids", async () => {
    const { platform } = setup([]);
    await blocked(platform.client.call("campaigns", "suspend", { SelectionCriteria: {} }, false));
  });

  it("allows the run's own campaign, group, phrases and ads", async () => {
    const { platform, guard, sent } = setup([
      { GeoRegions: [{ GeoRegionId: 213, GeoRegionName: "Москва", GeoRegionType: "City" }] },
      { AddResults: [{ Id: 101 }] },
      { AddResults: [{ Id: 301 }] },
      { AddResults: [{ Id: 401 }] },
      { Campaigns: [{ Id: 101, Name: `${CONTRACT_PREFIX}x`, State: "OFF", Status: "DRAFT" }] },
      { AdGroups: [{ Id: 301 }] },
      { AddResults: [{ Id: 201 }] },
      { Ads: [{ Id: 201, CampaignId: 101, State: "OFF", Status: "DRAFT" }] },
      { SuspendResults: [{ Id: 201 }] },
      { Ads: [{ Id: 201, CampaignId: 101, State: "SUSPENDED", Status: "DRAFT" }] },
      { DeleteResults: [{ Id: 101 }] },
    ]);
    const campaign = await platform.createCampaign({
      name: `${CONTRACT_PREFIX}x`,
      channel: "search",
      weeklyLimit: 30_000,
      strategyId: "WB_MAXIMUM_CLICKS",
      siteMonitoring: true,
      targeting: { city: "Москва", keywords: ["маникюр"], negativeKeywords: [] },
      schedule: "10:00–20:00",
    });
    const ad = await platform.createAd({ campaignId: campaign.id, title: "t", text: "x", landingUrl: "https://example.com" });
    await platform.updateAd(ad.id, { status: "paused" });
    await platform.client.call("campaigns", "delete", { SelectionCriteria: { Ids: guard.ownCampaigns() } }, false);
    expect(sent).toContain("campaigns.delete");
    expect(sent).not.toContain("ads.moderate");
  });

  it("deletes only prefixed drafts left by earlier runs", async () => {
    const { platform, sent } = setup([
      {
        Campaigns: [
          { Id: 7, Name: `${CONTRACT_PREFIX}old`, Status: "DRAFT" },
          { Id: 8, Name: "Настоящая кампания", Status: "ACCEPTED" },
          { Id: 9, Name: `${CONTRACT_PREFIX}shown`, Status: "ACCEPTED" },
        ],
      },
      { DeleteResults: [{ Id: 7 }] },
    ]);
    await platform.client.call("campaigns", "get", { SelectionCriteria: {}, FieldNames: ["Id", "Name", "Status"] }, true);
    await platform.client.call("campaigns", "delete", { SelectionCriteria: { Ids: [7] } }, false);
    await blocked(platform.client.call("campaigns", "delete", { SelectionCriteria: { Ids: [8] } }, false));
    await blocked(platform.client.call("campaigns", "delete", { SelectionCriteria: { Ids: [9] } }, false));
    expect(sent).toEqual(["campaigns.get", "campaigns.delete"]);
  });
});

describe("preflightContractAccount", () => {
  const client = (answer: unknown) => setup([answer]).platform.client;

  it("passes for the configured RUB advertiser login", async () => {
    await preflightContractAccount(client({ Clients: [{ Login: "ArtemBakradze", Currency: "RUB", Type: "CLIENT" }] }), "artembakradze");
  });

  it("stops on another login, currency or an agency", async () => {
    await expect(preflightContractAccount(client({ Clients: [{ Login: "someone", Currency: "RUB" }] }), "artembakradze")).rejects.toThrow(/belongs to someone/);
    await expect(preflightContractAccount(client({ Clients: [{ Login: "artembakradze", Currency: "USD" }] }), "artembakradze")).rejects.toThrow(/not RUB/);
    await expect(preflightContractAccount(client({ Clients: [{ Login: "artembakradze", Currency: "RUB", Type: "AGENCY" }] }), "artembakradze")).rejects.toThrow(/agency/);
  });

  it("explains an unapproved application (error 58)", async () => {
    const answer = new Response(JSON.stringify({ error: { error_code: 58, error_string: "Незавершенная регистрация", request_id: "r" } }));
    await expect(preflightContractAccount(client(answer), "artembakradze")).rejects.toThrow(/заявка на доступ к API Директа не одобрена/);
  });
});
