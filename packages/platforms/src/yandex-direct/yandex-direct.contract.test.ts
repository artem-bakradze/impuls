import { describe, expect, it } from "vitest";
import { PlatformError } from "../contract";
import type { DirectRequestLogEntry } from "./client";
import { YandexDirectPlatform } from "./platform";

/**
 * Contract tests against the real Direct sandbox (`pnpm test:contract`).
 * Required: DIRECT_SANDBOX_TOKEN. Optional: DIRECT_SANDBOX_CLIENT_LOGIN.
 * Missing credentials fail the run (AGENTS.md: fail fast, never skip silently).
 */
const token = process.env.DIRECT_SANDBOX_TOKEN;
if (!token) {
  throw new Error(
    "DIRECT_SANDBOX_TOKEN is not set: Direct sandbox contract tests require an OAuth token with Direct sandbox access. Refusing to skip.",
  );
}
const clientLogin = process.env.DIRECT_SANDBOX_CLIENT_LOGIN;

const logs: DirectRequestLogEntry[] = [];
let adGroupId: string | null = null;

const platform = new YandexDirectPlatform({
  mode: "sandbox",
  token,
  ...(clientLogin ? { clientLogin } : {}),
  logger: (entry) => logs.push(entry),
  resolveAdTarget: (campaignId) => createAdGroup(campaignId),
});

/** Ad groups are outside the platform contract; the sandbox test creates one through the low-level client. */
const createAdGroup = async (campaignId: string): Promise<{ adGroupId: string; href: string }> => {
  if (!adGroupId) {
    const result = await platform.client.call(
      "adgroups",
      "add",
      { AdGroups: [{ Name: "contract-test", CampaignId: Number(campaignId), RegionIds: [225] }] },
      false,
    );
    const item = (result.AddResults as { Id?: number }[] | undefined)?.[0];
    if (!item?.Id) {
      throw new Error(`AdGroups.add failed: ${JSON.stringify(result)}`);
    }
    adGroupId = String(item.Id);
  }
  return { adGroupId, href: "https://example.com" };
};

describe("YandexDirectPlatform (sandbox contract)", () => {
  const startedAt = new Date(Date.now() - 60_000);
  let campaignId = "";
  let adId = "";

  it("declares capabilities", () => {
    expect(platform.capabilities().strategies.map((s) => s.id)).toEqual(["WB_MAXIMUM_CLICKS", "AVERAGE_CPA"]);
  });

  it("creates and reads a campaign", async () => {
    const created = await platform.createCampaign({
      name: `[Импульс] contract ${new Date().toISOString()}`,
      weeklyLimit: 50_000,
      strategyId: "WB_MAXIMUM_CLICKS",
      siteMonitoring: true,
    });
    campaignId = created.id;
    expect(created).toMatchObject({ weeklyLimit: 50_000, strategyId: "WB_MAXIMUM_CLICKS", siteMonitoring: true });
    const [read] = await platform.getCampaigns([campaignId]);
    expect(read).toEqual(created);
  });

  it("updates limit, monitoring and status", async () => {
    const updated = await platform.updateCampaign(campaignId, { weeklyLimit: 60_000, siteMonitoring: false });
    expect(updated).toMatchObject({ weeklyLimit: 60_000, siteMonitoring: false });
    // A draft campaign may not be suspendable in the sandbox; this documents the actual behaviour.
    const paused = await platform.updateCampaign(campaignId, { status: "paused" });
    expect(paused.status).toBe("paused");
    const resumed = await platform.updateCampaign(campaignId, { status: "active" });
    expect(resumed.status).toBe("active");
  });

  it("creates, edits and reads an ad", async () => {
    const ad = await platform.createAd({ campaignId, title: "Ремонт квартир под ключ", text: "Смета за один день. Гарантия 3 года." });
    adId = ad.id;
    expect(ad).toMatchObject({ campaignId, title: "Ремонт квартир под ключ" });
    const edited = await platform.updateAd(adId, { text: "Смета бесплатно. Гарантия 3 года." });
    expect(edited.text).toBe("Смета бесплатно. Гарантия 3 года.");
    const ads = await platform.getAds([campaignId]);
    expect(ads.map((a) => a.id)).toContain(adId);
  });

  it("checks changes", async () => {
    const result = await platform.checkChanges([campaignId], startedAt);
    expect(result.checkedAt).toBeInstanceOf(Date);
    expect(result.campaigns.every((c) => c.campaignId === campaignId)).toBe(true);
  });

  it("loads stats", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await platform.getStats([campaignId], today, today);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("reports balance as not supported", async () => {
    await expect(platform.getBalance()).rejects.toBeInstanceOf(PlatformError);
  });

  it("never logs the token", () => {
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain(token);
  });
});
