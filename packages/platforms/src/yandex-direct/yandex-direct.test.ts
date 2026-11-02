import { describe, expect, it } from "vitest";
import { PlatformError } from "../contract";
import type { DirectRequestLogEntry } from "./client";
import { DIRECT_MAX_ATTEMPTS } from "./client";
import { bidModifierToPercent, buildTimeTargeting, kopecksToMicros, microsToKopecks, parseBreakdownTsv, parseStatsTsv, percentToBidModifier } from "./mapping";
import { YandexDirectPlatform } from "./platform";
import type { YandexDirectPlatformOptions } from "./platform";

const TOKEN = "secret-oauth-token-123";

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

interface FakeResponse {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

const json = (result: unknown, headers: Record<string, string> = {}): FakeResponse => ({ body: { result }, headers });
const directError = (code: number, message = "Ошибка", detail = ""): FakeResponse => ({
  body: { error: { request_id: "r", error_code: code, error_string: message, error_detail: detail } },
});

const setup = (responses: FakeResponse[], extra: Partial<YandexDirectPlatformOptions> = {}) => {
  const requests: RecordedRequest[] = [];
  const logs: DirectRequestLogEntry[] = [];
  const sleeps: number[] = [];
  let n = 0;
  const fakeFetch: typeof fetch = (input, init) => {
    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected request #${requests.length + 1}`);
    }
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const rawBody = typeof init?.body === "string" ? init.body : "";
    requests.push({ url: input instanceof Request ? input.url : String(input), headers, body: JSON.parse(rawBody) as unknown });
    n++;
    const body = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return Promise.resolve(
      new Response(body, { status: next.status ?? 200, headers: { RequestId: `req-${n}`, Units: "10/20000/64000", ...next.headers } }),
    );
  };
  const platform = new YandexDirectPlatform({
    token: TOKEN,
    submitAdsForModeration: true,
    fetch: fakeFetch,
    logger: (entry) => logs.push(entry),
    now: () => new Date("2026-10-28T09:00:00Z"),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...extra,
  });
  return { platform, requests, logs, sleeps, responses };
};

const rawCampaign = {
  Id: 101,
  Name: "[Импульс] Ремонт",
  State: "ON",
  Status: "ACCEPTED",
  TextCampaign: {
    BiddingStrategy: {
      Search: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 500_000_000 } },
      Network: { BiddingStrategyType: "SERVING_OFF" },
    },
    Settings: [{ Option: "ENABLE_SITE_MONITORING", Value: "YES" }],
  },
};

const rawAd = (overrides: Record<string, unknown> = {}) => ({
  Id: 201,
  CampaignId: 101,
  AdGroupId: 301,
  State: "ON",
  Status: "ACCEPTED",
  StatusClarification: "",
  TextAd: { Title: "Ремонт квартир", Title2: null, Text: "Быстро и недорого", Href: "https://example.ru" },
  ...overrides,
});

const geoRegions = json({
  GeoRegions: [
    { GeoRegionId: 213, GeoRegionName: "Москва", GeoRegionType: "City", ParentId: 1 },
    { GeoRegionId: 1, GeoRegionName: "Москва и Московская область", GeoRegionType: "Administrative area", ParentId: 3 },
    { GeoRegionId: 2, GeoRegionName: "Санкт-Петербург", GeoRegionType: "City", ParentId: 10174 },
  ],
});

const searchCampaign = {
  name: "[Импульс] Ремонт",
  channel: "search" as const,
  weeklyLimit: 50_000,
  strategyId: "WB_MAXIMUM_CLICKS",
  siteMonitoring: true,
  targeting: { city: "Москва", keywords: ["ремонт квартир", "ремонт квартир москва"], negativeKeywords: ["своими руками", "вакансии"] },
  schedule: "Пн–Пт 10:00–22:00",
};

/** Responses for Campaigns.add → AdGroups.add → Keywords.add → Campaigns.get after the dictionary. */
const createResponses = (keywords: number, campaign: unknown = rawCampaign): FakeResponse[] => [
  json({ AddResults: [{ Id: 101 }] }),
  json({ AddResults: [{ Id: 301 }] }),
  json({ AddResults: Array.from({ length: keywords }, (_, i) => ({ Id: 400 + i })) }),
  json({ Campaigns: [campaign] }),
];

const expectPlatformError = async (promise: Promise<unknown>, code: string, retryable?: boolean) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PlatformError);
  expect((error as PlatformError).code).toBe(code);
  if (retryable !== undefined) {
    expect((error as PlatformError).retryable).toBe(retryable);
  }
};

describe("money conversion", () => {
  it("converts kopecks to micros and back", () => {
    expect(kopecksToMicros(30_000)).toBe(300_000_000);
    expect(microsToKopecks(300_000_000)).toBe(30_000);
    expect(microsToKopecks(123_456)).toBe(12);
  });

  it("rejects fractional kopecks", () => {
    expect(() => kopecksToMicros(1.5)).toThrow(PlatformError);
  });
});

describe("request shape", () => {
  it("creates a search campaign with one ad group, regions, phrases and schedule", async () => {
    const { platform, requests } = setup([geoRegions, ...createResponses(2)], { clientLogin: "client-login" });
    const campaign = await platform.createCampaign(searchCampaign);

    expect(requests.map((r) => [r.url.replace("https://api.direct.yandex.com/json/v5/", ""), (r.body as { method: string }).method])).toEqual([
      ["dictionaries", "get"],
      ["campaigns", "add"],
      ["adgroups", "add"],
      ["keywords", "add"],
      ["campaigns", "get"],
    ]);
    expect(requests[1]?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "Accept-Language": "ru", "Client-Login": "client-login" });
    const add = (requests[1]?.body as { params: { Campaigns: Record<string, unknown>[] } }).params.Campaigns[0];
    expect(add).toMatchObject({
      Name: "[Импульс] Ремонт",
      StartDate: "2026-10-28",
      TextCampaign: {
        BiddingStrategy: {
          Search: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 500_000_000 } },
          Network: { BiddingStrategyType: "SERVING_OFF" },
        },
        Settings: [{ Option: "ENABLE_SITE_MONITORING", Value: "YES" }],
      },
    });
    const items = (add?.TimeTargeting as { Schedule: { Items: string[] } }).Schedule.Items;
    expect(items).toHaveLength(7);
    expect(items[0]).toBe(["1", ...Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 22 ? "100" : "0"))].join(","));
    expect(items[6]).toBe(["7", ...Array.from({ length: 24 }, () => "0")].join(","));
    expect(requests[2]?.body).toEqual({
      method: "add",
      params: { AdGroups: [{ Name: "[Импульс] Ремонт", CampaignId: 101, RegionIds: [213], NegativeKeywords: { Items: ["своими руками", "вакансии"] } }] },
    });
    expect(requests[3]?.body).toEqual({
      method: "add",
      params: { Keywords: [{ AdGroupId: 301, Keyword: "ремонт квартир" }, { AdGroupId: 301, Keyword: "ремонт квартир москва" }] },
    });
    expect(campaign).toEqual({ id: "101", name: "[Импульс] Ремонт", status: "active", weeklyLimit: 50_000, strategyId: "WB_MAXIMUM_CLICKS", siteMonitoring: true });
  });

  it("creates a partner-sites campaign with search switched off and autotargeting", async () => {
    const networkRaw = {
      ...rawCampaign,
      TextCampaign: {
        ...rawCampaign.TextCampaign,
        BiddingStrategy: { Search: { BiddingStrategyType: "SERVING_OFF" }, Network: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 300_000_000 } } },
      },
    };
    const { platform, requests } = setup([geoRegions, ...createResponses(1, networkRaw)]);
    const campaign = await platform.createCampaign({ ...searchCampaign, channel: "network", weeklyLimit: 30_000, targeting: { city: "Санкт-Петербург", keywords: [], negativeKeywords: [] } });
    expect(requests[1]?.body).toMatchObject({
      params: { Campaigns: [{ TextCampaign: { BiddingStrategy: { Search: { BiddingStrategyType: "SERVING_OFF" }, Network: { BiddingStrategyType: "WB_MAXIMUM_CLICKS" } } } }] },
    });
    expect(requests[2]?.body).toEqual({ method: "add", params: { AdGroups: [{ Name: "[Импульс] Ремонт", CampaignId: 101, RegionIds: [2] }] } });
    expect(requests[3]?.body).toEqual({ method: "add", params: { Keywords: [{ AdGroupId: 301, Keyword: "---autotargeting" }] } });
    expect(campaign).toMatchObject({ weeklyLimit: 30_000, strategyId: "WB_MAXIMUM_CLICKS" });
  });

  it("refuses a search campaign without phrases before any request", async () => {
    const { platform, requests } = setup([]);
    await expectPlatformError(platform.createCampaign({ ...searchCampaign, targeting: { ...searchCampaign.targeting, keywords: [] } }), "KEYWORDS_REQUIRED");
    expect(requests).toHaveLength(0);
  });

  it("refuses an unknown city without creating anything", async () => {
    const { platform, requests } = setup([geoRegions]);
    await expectPlatformError(platform.createCampaign({ ...searchCampaign, targeting: { ...searchCampaign.targeting, city: "Атлантида" } }), "UNKNOWN_CITY");
    expect(requests).toHaveLength(1);
  });

  it("refuses an unsupported schedule before any request", async () => {
    const { platform, requests } = setup([]);
    await expectPlatformError(platform.createCampaign({ ...searchCampaign, schedule: "по договорённости" }), "INVALID_SCHEDULE");
    expect(requests).toHaveLength(0);
  });

  it("uses the production API; the sandbox is gone", async () => {
    const { platform, requests } = setup([json({ Campaigns: [rawCampaign] })]);
    await platform.getCampaigns(["101"]);
    expect(requests[0]?.url).toBe("https://api.direct.yandex.com/json/v5/campaigns");
    expect(requests[0]?.headers).not.toHaveProperty("Client-Login");
  });

  it("builds AVERAGE_CPA from the lead goal", async () => {
    const { platform, requests } = setup([geoRegions, ...createResponses(2)]);
    await platform.createCampaign({ ...searchCampaign, strategyId: "AVERAGE_CPA", siteMonitoring: false, leadGoal: { goalId: "777", targetCostPerLead: 80_000 } });
    expect(requests[1]?.body).toMatchObject({
      params: {
        Campaigns: [
          {
            TextCampaign: {
              BiddingStrategy: {
                Search: { BiddingStrategyType: "AVERAGE_CPA", AverageCpa: { AverageCpa: 800_000_000, GoalId: 777, WeeklySpendLimit: 500_000_000 } },
              },
              Settings: [{ Option: "ENABLE_SITE_MONITORING", Value: "NO" }],
            },
          },
        ],
      },
    });
  });

  it("fails fast for AVERAGE_CPA without a lead goal", async () => {
    const { platform, requests } = setup([]);
    await expectPlatformError(platform.createCampaign({ ...searchCampaign, strategyId: "AVERAGE_CPA" }), "LEAD_GOAL_REQUIRED");
    expect(requests).toHaveLength(0);
  });

  it("switches an existing campaign to AVERAGE_CPA only with a lead goal", async () => {
    const { platform, requests } = setup([json({ Campaigns: [rawCampaign] })]);
    await expectPlatformError(platform.updateCampaign("101", { strategyId: "AVERAGE_CPA" }), "LEAD_GOAL_REQUIRED");
    expect(requests).toHaveLength(1);
  });

  it("updates the schedule", async () => {
    const { platform, requests } = setup([json({ UpdateResults: [{ Id: 101 }] }), json({ Campaigns: [rawCampaign] })]);
    await platform.updateCampaign("101", { schedule: "09:00–18:00" });
    const items = (requests[0]?.body as { params: { Campaigns: { TimeTargeting: { Schedule: { Items: string[] } } }[] } }).params.Campaigns[0]?.TimeTargeting.Schedule.Items;
    expect(items?.[6]).toBe(["7", ...Array.from({ length: 24 }, (_, h) => (h >= 9 && h < 18 ? "100" : "0"))].join(","));
  });

  it("moves the campaign's ad group to the region of a new city", async () => {
    const { platform, requests } = setup([
      geoRegions,
      json({ AdGroups: [{ Id: 301 }] }),
      json({ UpdateResults: [{ Id: 301 }] }),
      json({ Campaigns: [rawCampaign] }),
    ]);
    await platform.updateCampaign("101", { city: "Санкт-Петербург" });
    expect(requests[2]?.body).toEqual({ method: "update", params: { AdGroups: [{ Id: 301, RegionIds: [2] }] } });
  });

  it("updates the weekly limit keeping the strategy, then suspends", async () => {
    const { platform, requests } = setup([
      json({ Campaigns: [rawCampaign] }),
      json({ UpdateResults: [{ Id: 101 }] }),
      json({ SuspendResults: [{ Id: 101 }] }),
      json({ Campaigns: [{ ...rawCampaign, State: "SUSPENDED" }] }),
    ]);
    const campaign = await platform.updateCampaign("101", { weeklyLimit: 70_000, status: "paused" });
    expect(requests[1]?.body).toEqual({
      method: "update",
      params: {
        Campaigns: [
          {
            Id: 101,
            TextCampaign: {
              BiddingStrategy: {
                Search: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 700_000_000 } },
                Network: { BiddingStrategyType: "SERVING_OFF" },
              },
            },
          },
        ],
      },
    });
    expect(requests[2]?.body).toEqual({ method: "suspend", params: { SelectionCriteria: { Ids: [101] } } });
    expect(campaign.status).toBe("paused");
  });

  it("creates an ad in the campaign's group with UTM tags and sends it to moderation", async () => {
    const { platform, requests } = setup([
      json({ AdGroups: [{ Id: 301 }] }),
      json({ AddResults: [{ Id: 201 }] }),
      json({ ModerateResults: [{ Id: 201 }] }),
      json({ Ads: [rawAd({ Status: "MODERATION" })] }),
    ]);
    const ad = await platform.createAd({ campaignId: "101", title: "Ремонт квартир", text: "Быстро и недорого", landingUrl: "https://example.ru/remont?city=msk&utm_source=old" });
    expect(requests[0]?.body).toEqual({ method: "get", params: { SelectionCriteria: { CampaignIds: [101] }, FieldNames: ["Id"] } });
    expect(requests[1]?.url).toBe("https://api.direct.yandex.com/json/v5/ads");
    expect(requests[1]?.body).toEqual({
      method: "add",
      params: {
        Ads: [
          {
            AdGroupId: 301,
            TextAd: {
              Title: "Ремонт квартир",
              Text: "Быстро и недорого",
              Href: "https://example.ru/remont?city=msk&utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}&utm_content={ad_id}",
              Mobile: "NO",
            },
          },
        ],
      },
    });
    expect(requests[2]?.body).toEqual({ method: "moderate", params: { SelectionCriteria: { Ids: [201] } } });
    expect(ad).toMatchObject({ id: "201", campaignId: "101", status: "active", moderation: "pending", rejectionReason: null });
  });

  it("leaves new ads as drafts when moderation is off (contract tests)", async () => {
    const { platform, requests } = setup([json({ AdGroups: [{ Id: 301 }] }), json({ AddResults: [{ Id: 201 }] }), json({ Ads: [rawAd({ Status: "DRAFT" })] })], {
      submitAdsForModeration: false,
    });
    await platform.createAd({ campaignId: "101", title: "t", text: "x", landingUrl: "https://example.ru" });
    expect(requests.map((r) => (r.body as { method: string }).method)).toEqual(["get", "add", "get"]);
  });

  it("refuses a landing URL that is not http(s) before any request", async () => {
    const { platform, requests } = setup([]);
    await expectPlatformError(platform.createAd({ campaignId: "101", title: "t", text: "x", landingUrl: "javascript:alert(1)" }), "INVALID_LANDING_URL");
    expect(requests).toHaveLength(0);
  });

  it("lets a request guard block a call before it is sent", async () => {
    const { platform, requests } = setup([], {
      guard: {
        before: (service, method) => {
          if (method === "moderate") {
            throw new Error(`blocked ${service}.${method}`);
          }
        },
        after: () => undefined,
      },
    });
    await expect(platform.client.call("ads", "moderate", { SelectionCriteria: { Ids: [1] } }, false)).rejects.toThrow("blocked ads.moderate");
    expect(requests).toHaveLength(0);
  });

  it("maps ad state and moderation", async () => {
    const { platform, requests } = setup([
      json({
        Ads: [
          rawAd(),
          rawAd({ Id: 202, State: "SUSPENDED", Status: "REJECTED", StatusClarification: "Нарушены правила" }),
          rawAd({ Id: 203, Status: "DRAFT" }),
          rawAd({ Id: 204, State: "OFF_BY_MONITORING" }),
        ],
      }),
    ]);
    const ads = await platform.getAds(["101"]);
    expect(requests[0]?.body).toMatchObject({ method: "get", params: { SelectionCriteria: { CampaignIds: [101], Types: ["TEXT_AD"] } } });
    expect(ads.map((a) => [a.id, a.status, a.moderation, a.rejectionReason])).toEqual([
      ["201", "active", "accepted", null],
      ["202", "paused", "rejected", "Нарушены правила"],
      ["203", "active", "pending", null],
      ["204", "active", "accepted", null],
    ]);
    // Direct paused the ad itself: status stays active, the reason is the monitoring stop.
    expect(ads.find((a) => a.id === "204")?.monitoringStopped).toBe(true);
    expect(ads.filter((a) => a.id !== "204").every((a) => !a.monitoringStopped)).toBe(true);
  });

  it("checks changes since a timestamp and filters to service campaigns", async () => {
    const { platform, requests } = setup([
      json({
        Campaigns: [
          { CampaignId: 101, ChangesIn: ["SELF", "STAT"] },
          { CampaignId: 999, ChangesIn: ["CHILDREN"] },
        ],
        Timestamp: "2026-10-28T09:00:05Z",
      }),
    ]);
    const result = await platform.checkChanges(["101"], new Date("2026-10-28T08:00:00.123Z"));
    expect(requests[0]?.url).toBe("https://api.direct.yandex.com/json/v5/changes");
    expect(requests[0]?.body).toEqual({ method: "checkCampaigns", params: { Timestamp: "2026-10-28T08:00:00Z" } });
    expect(result).toEqual({ checkedAt: new Date("2026-10-28T09:00:05Z"), campaigns: [{ campaignId: "101", areas: ["SELF", "STAT"] }] });
  });

  it("does not invent a balance endpoint", async () => {
    const { platform, requests } = setup([]);
    await expectPlatformError(platform.getBalance(), "NOT_SUPPORTED", false);
    expect(requests).toHaveLength(0);
  });
});

const TSV = [
  '"impuls-stats-1 (2026-10-26 - 2026-10-27)"',
  "Date\tCampaignId\tAdId\tImpressions\tClicks\tCost\tConversions",
  "2026-10-26\t101\t201\t120\t7\t154.37\t1",
  "2026-10-27\t101\t202\t30\t0\t0.00\t--",
  "Total rows: 2",
  "",
].join("\n");

describe("reports", () => {
  it("parses TSV, skipping title and total rows, reading -- as 0", () => {
    expect(parseStatsTsv(TSV)).toEqual([
      { date: "2026-10-26", campaignId: "101", adId: "201", impressions: 120, clicks: 7, spend: 15_437, leads: 1 },
      { date: "2026-10-27", campaignId: "101", adId: "202", impressions: 30, clicks: 0, spend: 0, leads: 0 },
    ]);
  });

  it("requests a VAT-inclusive custom report and polls offline reports", async () => {
    const { platform, requests, sleeps, logs } = setup([
      { status: 201, body: "", headers: { retryIn: "3" } },
      { status: 202, body: "", headers: { retryIn: "7" } },
      { status: 200, body: TSV },
    ]);
    const rows = await platform.getStats(["101"], "2026-10-26", "2026-10-27");
    expect(rows).toHaveLength(2);
    expect(requests).toHaveLength(3);
    expect(requests[0]?.url).toBe("https://api.direct.yandex.com/json/v5/reports");
    expect(requests[0]?.headers).toMatchObject({ processingMode: "auto", returnMoneyInMicros: "false", Authorization: `Bearer ${TOKEN}` });
    expect(requests[0]?.body).toMatchObject({
      params: {
        SelectionCriteria: { DateFrom: "2026-10-26", DateTo: "2026-10-27", Filter: [{ Field: "CampaignId", Operator: "IN", Values: ["101"] }] },
        FieldNames: ["Date", "CampaignId", "AdId", "Impressions", "Clicks", "Cost", "Conversions"],
        ReportType: "CUSTOM_REPORT",
        DateRangeType: "CUSTOM_DATE",
        Format: "TSV",
        IncludeVAT: "YES",
      },
    });
    // Same report name on every poll so Direct returns the queued report.
    expect(requests[1]?.body).toEqual(requests[0]?.body);
    expect(sleeps).toEqual([3_000, 7_000]);
    expect(logs.map((l) => l.outcome)).toEqual(["report_pending", "report_pending", "ok"]);
  });

  it("fails explicitly when the offline report never becomes ready", async () => {
    const { platform, requests } = setup(
      Array.from({ length: 3 }, () => ({ status: 202, body: "", headers: { retryIn: "1" } })),
      { maxReportPolls: 2 },
    );
    await expectPlatformError(platform.getStats(["101"], "2026-10-26", "2026-10-27"), "REPORT_NOT_READY");
    expect(requests).toHaveLength(3);
  });

  it("maps a Reports error body", async () => {
    const { platform } = setup([{ status: 400, body: directError(4000, "Параметры запроса указаны неверно").body }]);
    await expectPlatformError(platform.getStats(["101"], "2026-10-26", "2026-10-27"), "DIRECT_ERROR_4000", false);
  });
});

describe("retry policy", () => {
  it("retries idempotent reads on transient errors with exponential backoff, logging each attempt", async () => {
    const { platform, requests, sleeps, logs } = setup([directError(1000), { status: 503, body: "oops" }, directError(52), json({ Campaigns: [rawCampaign] })]);
    const [campaign] = await platform.getCampaigns(["101"]);
    expect(campaign?.id).toBe("101");
    expect(requests).toHaveLength(4);
    expect(sleeps).toEqual([1_000, 2_000, 4_000]);
    expect(logs.map((l) => [l.attempt, l.outcome, l.willRetry])).toEqual([
      [1, "error", true],
      [2, "error", true],
      [3, "error", true],
      [4, "ok", false],
    ]);
  });

  it(`gives up after ${DIRECT_MAX_ATTEMPTS} attempts with an explicit error`, async () => {
    const { platform, requests } = setup(Array.from({ length: DIRECT_MAX_ATTEMPTS }, () => directError(1002)));
    await expectPlatformError(platform.getCampaigns(["101"]), "DIRECT_UNAVAILABLE", true);
    expect(requests).toHaveLength(DIRECT_MAX_ATTEMPTS);
  });

  it("retries checkCampaigns", async () => {
    const { platform, requests } = setup([directError(1001), json({ Campaigns: [], Timestamp: "2026-10-28T09:00:00Z" })]);
    await platform.checkChanges(["101"], new Date("2026-10-28T08:00:00Z"));
    expect(requests).toHaveLength(2);
  });

  it("retries network failures of reads", async () => {
    const logs: DirectRequestLogEntry[] = [];
    let calls = 0;
    const platform = new YandexDirectPlatform({
      token: TOKEN,
      submitAdsForModeration: true,
      logger: (e) => logs.push(e),
      sleep: () => Promise.resolve(),
      fetch: () => {
        calls++;
        return calls === 1 ? Promise.reject(new TypeError("fetch failed")) : Promise.resolve(new Response(JSON.stringify({ result: { Campaigns: [rawCampaign] } })));
      },
    });
    await platform.getCampaigns(["101"]);
    expect(calls).toBe(2);
    expect(logs[0]).toMatchObject({ status: null, errorCode: "DIRECT_NETWORK_ERROR", willRetry: true });
  });

  it("never retries mutations", async () => {
    const { platform, requests, sleeps } = setup([json({ Campaigns: [rawCampaign] }), directError(1000)]);
    await expectPlatformError(platform.updateCampaign("101", { weeklyLimit: 70_000 }), "DIRECT_UNAVAILABLE", true);
    expect(requests).toHaveLength(2);
    expect(sleeps).toEqual([]);
  });

  it("never retries ad suspend on HTTP 5xx", async () => {
    const { platform, requests } = setup([{ status: 500, body: "" }]);
    await expectPlatformError(platform.updateAd("201", { status: "paused" }), "DIRECT_UNAVAILABLE", true);
    expect(requests).toHaveLength(1);
  });

  it("does not retry non-retryable errors on reads", async () => {
    const { platform, requests } = setup([directError(152, "Недостаточно баллов")]);
    await expectPlatformError(platform.getCampaigns(["101"]), "POINTS_EXHAUSTED", false);
    expect(requests).toHaveLength(1);
  });
});

describe("error mapping", () => {
  it.each([
    [53, "Ошибка авторизации", "", "DIRECT_TOKEN_REVOKED", false],
    [58, "Незавершенная регистрация", "", "DIRECT_APP_NOT_APPROVED", false],
    [152, "Недостаточно баллов", "", "POINTS_EXHAUSTED", false],
    [8800, "Объект не найден", "", "NOT_FOUND", false],
    [8000, "Некорректный запрос", "Необходимо заполнить данные рекламодателя для маркировки", "ADVERTISER_DATA_REQUIRED", false],
    [3500, "Не поддерживается", "", "DIRECT_ERROR_3500", false],
  ])("maps request error %i to %s", async (code, message, detail, expected, retryable) => {
    const { platform } = setup([directError(code, message, detail)]);
    await expectPlatformError(platform.getCampaigns(["101"]), expected, retryable);
  });

  it("maps per-object errors in action results", async () => {
    const { platform } = setup([
      geoRegions,
      json({ AddResults: [{ Errors: [{ Code: 6000, Message: "Неконсистентное состояние объекта", Details: "Не заполнены данные для маркировки рекламы (ОРД)" }] }] }),
    ]);
    await expectPlatformError(platform.createCampaign(searchCampaign), "ADVERTISER_DATA_REQUIRED");
  });

  it("maps generic per-object errors by code", async () => {
    const { platform } = setup([json({ AdGroups: [{ Id: 301 }] }), json({ AddResults: [{ Errors: [{ Code: 5001, Message: "Превышена допустимая длина" }] }] })]);
    await expectPlatformError(platform.createAd({ campaignId: "101", title: "t", text: "x", landingUrl: "https://example.ru" }), "DIRECT_ERROR_5001", false);
  });
});

describe("request journal", () => {
  it("logs method, service, request id, status, duration and units without the token", async () => {
    const { platform, logs } = setup([directError(53), json({ Campaigns: [rawCampaign] })]);
    await expectPlatformError(platform.getCampaigns(["101"]), "DIRECT_TOKEN_REVOKED");
    await platform.getCampaigns(["101"]);
    expect(logs[1]).toEqual({
      service: "campaigns",
      method: "get",
      attempt: 1,
      status: 200,
      requestId: "req-2",
      units: "10/20000/64000",
      durationMs: 0,
      outcome: "ok",
      errorCode: null,
      willRetry: false,
    });
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });

  it("refuses to start without a token", () => {
    expect(() => new YandexDirectPlatform({ token: "", submitAdsForModeration: true, logger: () => undefined })).toThrow(/token is required/);
  });
});

describe("time targeting", () => {
  const hoursOf = (schedule: string, day: number): number[] => {
    const items = (buildTimeTargeting(schedule) as { Schedule: { Items: string[] } }).Schedule.Items;
    return (items[day]?.split(",").slice(1) ?? []).map(Number);
  };
  const on = (hours: number[]): number[] => hours.flatMap((v, h) => (v > 0 ? [h] : []));

  it("runs round the clock for 00:00–24:00", () => {
    expect(on(hoursOf("Пн–Вс 00:00–24:00", 0))).toHaveLength(24);
  });

  it("keeps the night hours of a schedule past midnight", () => {
    expect(on(hoursOf("Пн–Вс 22:00–02:00", 3))).toEqual([0, 1, 22, 23]);
  });

  it("switches Monday off for «Вт–Вс»", () => {
    expect(on(hoursOf("Вт–Вс 10:00–20:00", 0))).toEqual([]);
    expect(on(hoursOf("Вт–Вс 10:00–20:00", 1))).toHaveLength(10);
  });

  it("refuses equal opening and closing hours", () => {
    expect(() => buildTimeTargeting("Пн–Вс 10:00–10:00")).toThrow(PlatformError);
  });
});

// Shapes from the Direct v5 documentation (Reports, Campaigns, BidModifiers); confirmed live in add-agent-analyst-stage1 task 1.1.
const QUERY_TSV = [
  '"impuls-query-1 (2026-10-14 - 2026-10-27)"',
  "CampaignId\tQuery\tImpressions\tClicks\tCost\tConversions",
  "101\tремонт квартир москва\t300\t20\t600.50\t3",
  "101\tремонт квартир бесплатно\t90\t6\t180.00\t--",
  "101\tремонт квартир москва\t10\t1\t30.00\t0",
  "101\t--\t5\t0\t0.00\t--",
  "Total rows: 4",
  "",
].join("\n");

const DEVICE_TSV = [
  '"impuls-device-1 (2026-10-14 - 2026-10-27)"',
  "CampaignId\tDevice\tImpressions\tClicks\tCost\tConversions",
  "101\tMOBILE\t500\t30\t900.00\t1",
  "101\tDESKTOP\t200\t15\t450.00\t3",
  "101\tTABLET\t20\t1\t30.00\t--",
  "101\tSMART_TV\t4\t1\t30.00\t--",
  "Total rows: 4",
  "",
].join("\n");

const modifier = (id: number, device: "mobile" | "desktop", bidModifier: number) => ({
  Id: id,
  CampaignId: 101,
  Level: "CAMPAIGN",
  Type: device === "mobile" ? "MOBILE_ADJUSTMENT" : "DESKTOP_ADJUSTMENT",
  ...(device === "mobile" ? { MobileAdjustment: { BidModifier: bidModifier } } : { DesktopAdjustment: { BidModifier: bidModifier } }),
});

describe("analyst levers and breakdowns (add-agent-analyst-stage1)", () => {
  it("converts Direct bid modifiers to adjustment percents and back", () => {
    expect(bidModifierToPercent(70)).toBe(-30);
    expect(bidModifierToPercent(150)).toBe(50);
    expect(percentToBidModifier(-25)).toBe(75);
  });

  it("parses a query report, merging repeated queries and skipping rows without a query", () => {
    expect(parseBreakdownTsv(QUERY_TSV, "query")).toEqual([
      { campaignId: "101", segment: "ремонт квартир москва", impressions: 310, clicks: 21, leads: 3, spend: 63_050 },
      { campaignId: "101", segment: "ремонт квартир бесплатно", impressions: 90, clicks: 6, leads: 0, spend: 18_000 },
    ]);
  });

  it("parses a device report, counting Smart TV with computers", () => {
    expect(parseBreakdownTsv(DEVICE_TSV, "device")).toEqual([
      { campaignId: "101", segment: "mobile", impressions: 500, clicks: 30, leads: 1, spend: 90_000 },
      { campaignId: "101", segment: "desktop", impressions: 204, clicks: 16, leads: 3, spend: 48_000 },
      { campaignId: "101", segment: "tablet", impressions: 20, clicks: 1, leads: 0, spend: 3_000 },
    ]);
  });

  it("requests the search query report with the same attribution and VAT as the daily stats", async () => {
    const { platform, requests } = setup([{ status: 200, body: QUERY_TSV }]);
    const rows = await platform.getBreakdown(["101"], "2026-10-14", "2026-10-27", "query");
    expect(rows).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://api.direct.yandex.com/json/v5/reports");
    expect(requests[0]?.body).toMatchObject({
      params: {
        SelectionCriteria: { DateFrom: "2026-10-14", DateTo: "2026-10-27", Filter: [{ Field: "CampaignId", Operator: "IN", Values: ["101"] }] },
        AttributionModels: ["AUTO"],
        FieldNames: ["CampaignId", "Query", "Impressions", "Clicks", "Cost", "Conversions"],
        ReportType: "SEARCH_QUERY_PERFORMANCE_REPORT",
        IncludeVAT: "YES",
      },
    });
  });

  it("requests the device split as a custom report", async () => {
    const { platform, requests } = setup([{ status: 200, body: DEVICE_TSV }]);
    await platform.getBreakdown(["101"], "2026-10-14", "2026-10-27", "device");
    expect(requests[0]?.body).toMatchObject({
      params: { FieldNames: ["CampaignId", "Device", "Impressions", "Clicks", "Cost", "Conversions"], ReportType: "CUSTOM_REPORT" },
    });
    // Different reports get different names, or Direct would return the queued one of the other kind.
    const names = new Set<unknown>();
    const other = setup([{ status: 200, body: QUERY_TSV }]);
    await other.platform.getBreakdown(["101"], "2026-10-14", "2026-10-27", "query");
    for (const request of [...requests, ...other.requests]) names.add((request.body as { params: { ReportName: unknown } }).params.ReportName);
    expect(names.size).toBe(2);
  });

  it("reads negative phrases and campaign-level adjustments", async () => {
    const { platform, requests } = setup([
      json({ Campaigns: [{ Id: 101, NegativeKeywords: { Items: ["бесплатно", "вакансии"] } }, { Id: 102, NegativeKeywords: null }] }),
      json({ BidModifiers: [modifier(9, "mobile", 70)] }),
    ]);
    expect(await platform.getTrafficSettings(["101", "102"])).toEqual([
      { campaignId: "101", negativeKeywords: ["бесплатно", "вакансии"], deviceAdjustments: { mobile: -30, desktop: 0 } },
      { campaignId: "102", negativeKeywords: [], deviceAdjustments: { mobile: 0, desktop: 0 } },
    ]);
    expect(requests[0]?.body).toEqual({ method: "get", params: { SelectionCriteria: { Ids: [101, 102] }, FieldNames: ["Id", "NegativeKeywords"] } });
    expect(requests[1]?.url).toBe("https://api.direct.yandex.com/json/v5/bidmodifiers");
    expect(requests[1]?.body).toEqual({
      method: "get",
      params: {
        SelectionCriteria: { CampaignIds: [101, 102], Levels: ["CAMPAIGN"] },
        FieldNames: ["Id", "CampaignId", "Type"],
        MobileAdjustmentFieldNames: ["BidModifier"],
        DesktopAdjustmentFieldNames: ["BidModifier"],
      },
    });
  });

  it("replaces the whole negative phrase list and removes an empty one with null", async () => {
    const { platform, requests } = setup([
      json({ UpdateResults: [{ Id: 101 }] }),
      json({ Campaigns: [rawCampaign] }),
      json({ UpdateResults: [{ Id: 101 }] }),
      json({ Campaigns: [rawCampaign] }),
    ]);
    await platform.updateCampaign("101", { negativeKeywords: ["бесплатно", "вакансии"] });
    await platform.updateCampaign("101", { negativeKeywords: [] });
    expect(requests[0]?.body).toEqual({ method: "update", params: { Campaigns: [{ Id: 101, NegativeKeywords: { Items: ["бесплатно", "вакансии"] } }] } });
    expect(requests[2]?.body).toEqual({ method: "update", params: { Campaigns: [{ Id: 101, NegativeKeywords: null }] } });
  });

  it("changes an existing adjustment and adds a missing one", async () => {
    const { platform, requests } = setup([
      json({ BidModifiers: [modifier(9, "mobile", 80)] }),
      json({ SetResults: [{ Id: 9 }] }),
      json({ AddResults: [{ Ids: [12] }] }),
      json({ Campaigns: [rawCampaign] }),
    ]);
    await platform.updateCampaign("101", { deviceAdjustments: { mobile: -30, desktop: 20 } });
    expect(requests[1]?.body).toEqual({ method: "set", params: { BidModifiers: [{ Id: 9, BidModifier: 70 }] } });
    expect(requests[2]?.body).toEqual({ method: "add", params: { BidModifiers: [{ CampaignId: 101, DesktopAdjustment: { BidModifier: 120 } }] } });
  });

  it("deletes an adjustment set back to 0% and leaves an unchanged one alone", async () => {
    const { platform, requests } = setup([
      json({ BidModifiers: [modifier(9, "mobile", 70), modifier(10, "desktop", 120)] }),
      json({ DeleteResults: [{ Id: 9 }] }),
      json({ Campaigns: [rawCampaign] }),
    ]);
    await platform.updateCampaign("101", { deviceAdjustments: { mobile: 0, desktop: 20 } });
    expect(requests).toHaveLength(3);
    expect(requests[1]?.body).toEqual({ method: "delete", params: { SelectionCriteria: { Ids: [9] } } });
  });

  it("reports a per-object error of an adjustment", async () => {
    const { platform } = setup([json({ BidModifiers: [] }), json({ AddResults: [{ Errors: [{ Code: 5005, Message: "Поле задано неверно" }] }] })]);
    await expectPlatformError(platform.updateCampaign("101", { deviceAdjustments: { mobile: -30, desktop: 0 } }), "DIRECT_ERROR_5005", false);
  });
});
