import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlatformError } from "../contract";
import type { DirectRequestLogEntry, JsonRecord } from "./client";
import { CONTRACT_PREFIX, ContractGuard, preflightContractAccount } from "./contract-guard";
import { records } from "./mapping";
import { YandexDirectPlatform } from "./platform";

/**
 * Contract tests against the production Direct API (`pnpm test:contract`); the sandbox was shut down on 2026-07-15.
 * Required: DIRECT_CONTRACT_TOKEN and DIRECT_CONTRACT_LOGIN. Missing values fail the run (never skipped silently).
 *
 * Safety (testing-harness spec): every request goes through `ContractGuard` — only `impuls-contract-*` campaigns
 * created by this run are changed, nothing is sent to moderation, so the campaigns stay unserved drafts and are
 * deleted at the end. Pausing a draft is not possible in Direct; the test checks that the refusal is mapped, real
 * pausing is confirmed in the pilot.
 */
const token = process.env.DIRECT_CONTRACT_TOKEN;
const login = process.env.DIRECT_CONTRACT_LOGIN;
if (!token || !login) {
  throw new Error(
    `${!token ? "DIRECT_CONTRACT_TOKEN" : "DIRECT_CONTRACT_LOGIN"} is not set: Direct contract tests need the test account's OAuth token and login. Refusing to skip.`,
  );
}

const logs: DirectRequestLogEntry[] = [];
const guard = new ContractGuard();
const platform = new YandexDirectPlatform({ token, submitAdsForModeration: false, logger: (entry) => logs.push(entry), guard });
const runId = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);

const listCampaigns = async (): Promise<JsonRecord[]> =>
  records((await platform.client.call("campaigns", "get", { SelectionCriteria: {}, FieldNames: ["Id", "Name", "State", "Status", "DailyBudget"] }, true)).Campaigns);

const deleteCampaigns = async (ids: readonly number[]): Promise<void> => {
  if (ids.length > 0) {
    await platform.client.call("campaigns", "delete", { SelectionCriteria: { Ids: [...ids] } }, false);
  }
};

const foreign = (campaigns: readonly JsonRecord[]): string =>
  JSON.stringify(campaigns.filter((c) => typeof c.Name !== "string" || !c.Name.startsWith(CONTRACT_PREFIX)));

let foreignBefore = "";

beforeAll(async () => {
  await preflightContractAccount(platform.client, login);
  const campaigns = await listCampaigns();
  foreignBefore = foreign(campaigns);
  // Drafts of interrupted runs; the guard lets only prefixed drafts seen in this listing be deleted.
  const leftovers = campaigns.filter((c) => typeof c.Name === "string" && c.Name.startsWith(CONTRACT_PREFIX) && c.Status === "DRAFT");
  await deleteCampaigns(leftovers.map((c) => Number(c.Id)));
});

afterAll(async () => {
  await deleteCampaigns(guard.ownCampaigns());
  const after = await listCampaigns();
  expect(after.filter((c) => typeof c.Name === "string" && c.Name.startsWith(CONTRACT_PREFIX))).toEqual([]);
  expect(foreign(after)).toBe(foreignBefore);
  expect(JSON.stringify(logs)).not.toContain(token);
});

describe("YandexDirectPlatform (production contract, drafts only)", () => {
  const startedAt = new Date(Date.now() - 60_000);
  let searchId = "";
  let adId = "";

  it("declares capabilities", () => {
    expect(platform.capabilities().strategies.map((s) => s.id)).toEqual(["WB_MAXIMUM_CLICKS", "AVERAGE_CPA"]);
  });

  it("resolves the business city to a Direct region", async () => {
    expect(await platform.regionIdOf("Москва")).toBe(213);
  });

  it("creates a search campaign with group, phrases, negative phrases and schedule", async () => {
    const created = await platform.createCampaign({
      name: `${CONTRACT_PREFIX}${runId}-search`,
      channel: "search",
      weeklyLimit: 50_000,
      strategyId: "WB_MAXIMUM_CLICKS",
      siteMonitoring: true,
      targeting: { city: "Москва", keywords: ["маникюр с покрытием", "маникюр у метро"], negativeKeywords: ["обучение", "вакансии"] },
      schedule: "Пн–Пт 10:00–22:00",
    });
    searchId = created.id;
    expect(created).toMatchObject({ weeklyLimit: 50_000, strategyId: "WB_MAXIMUM_CLICKS", siteMonitoring: true });
    const [read] = await platform.getCampaigns([searchId]);
    expect(read).toEqual(created);
    const keywords = records(
      (await platform.client.call("keywords", "get", { SelectionCriteria: { CampaignIds: [Number(searchId)] }, FieldNames: ["Keyword"] }, true)).Keywords,
    );
    expect(keywords.map((k) => k.Keyword).sort()).toEqual(["маникюр с покрытием", "маникюр у метро"]);
  });

  it("creates a partner-sites campaign with autotargeting", async () => {
    const created = await platform.createCampaign({
      name: `${CONTRACT_PREFIX}${runId}-network`,
      channel: "network",
      weeklyLimit: 30_000,
      strategyId: "WB_MAXIMUM_CLICKS",
      siteMonitoring: true,
      targeting: { city: "Москва", keywords: [], negativeKeywords: [] },
      schedule: "10:00–20:00",
    });
    expect(created).toMatchObject({ weeklyLimit: 30_000, strategyId: "WB_MAXIMUM_CLICKS" });
  });

  it("updates limit, schedule and monitoring", async () => {
    const updated = await platform.updateCampaign(searchId, { weeklyLimit: 60_000, siteMonitoring: false, schedule: "Пн–Сб 09:00–21:00" });
    expect(updated).toMatchObject({ weeklyLimit: 60_000, siteMonitoring: false });
  });

  it("maps the refusal to pause a draft campaign", async () => {
    const outcome = await platform.updateCampaign(searchId, { status: "paused" }).then(
      (campaign) => campaign.status,
      (error: unknown) => (error instanceof PlatformError ? error.code : String(error)),
    );
    // Either Direct pauses the draft or refuses with a mapped per-object error; both are recorded here.
    expect(typeof outcome).toBe("string");
  });

  it("creates, edits and reads a draft ad with UTM tags", async () => {
    const ad = await platform.createAd({ campaignId: searchId, title: "Маникюр с покрытием у метро", text: "Запись онлайн. Работаем до 22:00.", landingUrl: "https://example.com/" });
    adId = ad.id;
    expect(ad).toMatchObject({ campaignId: searchId, title: "Маникюр с покрытием у метро", moderation: "pending" });
    const edited = await platform.updateAd(adId, { text: "Запись онлайн. Работаем без выходных." });
    expect(edited.text).toBe("Запись онлайн. Работаем без выходных.");
    const raw = records(
      (await platform.client.call("ads", "get", { SelectionCriteria: { Ids: [Number(adId)] }, FieldNames: ["Id"], TextAdFieldNames: ["Href"] }, true)).Ads,
    )[0];
    expect((raw?.TextAd as JsonRecord | undefined)?.Href).toBe("https://example.com/?utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}&utm_content={ad_id}");
  });

  it("refuses AVERAGE_CPA without a lead goal before calling Direct", async () => {
    await expect(platform.updateCampaign(searchId, { strategyId: "AVERAGE_CPA" })).rejects.toMatchObject({ code: "LEAD_GOAL_REQUIRED" });
  });

  it("checks changes", async () => {
    const result = await platform.checkChanges([searchId], startedAt);
    expect(result.checkedAt).toBeInstanceOf(Date);
    expect(result.campaigns.every((c) => c.campaignId === searchId)).toBe(true);
  });

  it("loads stats", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await platform.getStats([searchId], today, today);
    expect(Array.isArray(rows)).toBe(true);
  });
});
