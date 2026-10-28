import { describe, expect, it } from "vitest";
import { PlatformError } from "../contract";
import type { DirectRequestLogEntry } from "./client";
import { DIRECT_MAX_ATTEMPTS } from "./client";
import { kopecksToMicros, microsToKopecks, parseStatsTsv } from "./mapping";
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
    mode: "sandbox",
    token: TOKEN,
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
  it("sends Campaigns.add to the sandbox with auth headers, micros and site monitoring", async () => {
    const { platform, requests } = setup([json({ AddResults: [{ Id: 101 }] }), json({ Campaigns: [rawCampaign] })], {
      clientLogin: "client-login",
    });
    const campaign = await platform.createCampaign({ name: "[Импульс] Ремонт", weeklyLimit: 50_000, strategyId: "WB_MAXIMUM_CLICKS", siteMonitoring: true });

    const add = requests[0];
    expect(add?.url).toBe("https://api-sandbox.direct.yandex.com/json/v5/campaigns");
    expect(add?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "Accept-Language": "ru", "Client-Login": "client-login" });
    expect(add?.body).toEqual({
      method: "add",
      params: {
        Campaigns: [
          {
            Name: "[Импульс] Ремонт",
            StartDate: "2026-10-28",
            TextCampaign: {
              BiddingStrategy: {
                Search: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 500_000_000 } },
                Network: { BiddingStrategyType: "SERVING_OFF" },
              },
              Settings: [{ Option: "ENABLE_SITE_MONITORING", Value: "YES" }],
            },
          },
        ],
      },
    });
    expect(requests[1]?.body).toMatchObject({ method: "get", params: { SelectionCriteria: { Ids: [101] } } });
    expect(campaign).toEqual({
      id: "101",
      name: "[Импульс] Ремонт",
      status: "active",
      weeklyLimit: 50_000,
      strategyId: "WB_MAXIMUM_CLICKS",
      siteMonitoring: true,
    });
  });

  it("uses the production URL and omits Client-Login when not given", async () => {
    const { platform, requests } = setup([json({ Campaigns: [rawCampaign] })], { mode: "production" });
    await platform.getCampaigns(["101"]);
    expect(requests[0]?.url).toBe("https://api.direct.yandex.com/json/v5/campaigns");
    expect(requests[0]?.headers).not.toHaveProperty("Client-Login");
  });

  it("builds AVERAGE_CPA from the resolver", async () => {
    const { platform, requests } = setup([json({ AddResults: [{ Id: 101 }] }), json({ Campaigns: [rawCampaign] })], {
      resolveAverageCpaParams: () => Promise.resolve({ averageCpa: 80_000, goalId: 777 }),
    });
    await platform.createCampaign({ name: "c", weeklyLimit: 50_000, strategyId: "AVERAGE_CPA", siteMonitoring: false });
    expect(requests[0]?.body).toMatchObject({
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

  it("fails fast for AVERAGE_CPA without a resolver", async () => {
    const { platform, requests } = setup([]);
    await expectPlatformError(platform.createCampaign({ name: "c", weeklyLimit: 50_000, strategyId: "AVERAGE_CPA", siteMonitoring: true }), "STRATEGY_PARAMS_REQUIRED");
    expect(requests).toHaveLength(0);
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
          { Id: 101, TextCampaign: { BiddingStrategy: { Search: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 700_000_000 } } } } },
        ],
      },
    });
    expect(requests[2]?.body).toEqual({ method: "suspend", params: { SelectionCriteria: { Ids: [101] } } });
    expect(campaign.status).toBe("paused");
  });

  it("creates an ad in the resolved group and sends it to moderation", async () => {
    const { platform, requests } = setup(
      [json({ AddResults: [{ Id: 201 }] }), json({ ModerateResults: [{ Id: 201 }] }), json({ Ads: [rawAd({ Status: "MODERATION" })] })],
      { resolveAdTarget: () => Promise.resolve({ adGroupId: "301", href: "https://example.ru" }) },
    );
    const ad = await platform.createAd({ campaignId: "101", title: "Ремонт квартир", text: "Быстро и недорого" });
    expect(requests[0]?.url).toBe("https://api-sandbox.direct.yandex.com/json/v5/ads");
    expect(requests[0]?.body).toEqual({
      method: "add",
      params: { Ads: [{ AdGroupId: 301, TextAd: { Title: "Ремонт квартир", Text: "Быстро и недорого", Href: "https://example.ru", Mobile: "NO" } }] },
    });
    expect(requests[1]?.body).toEqual({ method: "moderate", params: { SelectionCriteria: { Ids: [201] } } });
    expect(ad).toMatchObject({ id: "201", campaignId: "101", status: "active", moderation: "pending", rejectionReason: null });
  });

  it("fails fast when creating an ad without a target resolver", async () => {
    const { platform } = setup([]);
    await expectPlatformError(platform.createAd({ campaignId: "101", title: "t", text: "x" }), "AD_TARGET_REQUIRED");
  });

  it("maps ad state and moderation", async () => {
    const { platform, requests } = setup([
      json({
        Ads: [
          rawAd(),
          rawAd({ Id: 202, State: "SUSPENDED", Status: "REJECTED", StatusClarification: "Нарушены правила" }),
          rawAd({ Id: 203, Status: "DRAFT" }),
        ],
      }),
    ]);
    const ads = await platform.getAds(["101"]);
    expect(requests[0]?.body).toMatchObject({ method: "get", params: { SelectionCriteria: { CampaignIds: [101], Types: ["TEXT_AD"] } } });
    expect(ads.map((a) => [a.id, a.status, a.moderation, a.rejectionReason])).toEqual([
      ["201", "active", "accepted", null],
      ["202", "paused", "rejected", "Нарушены правила"],
      ["203", "active", "pending", null],
    ]);
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
    expect(requests[0]?.url).toBe("https://api-sandbox.direct.yandex.com/json/v5/changes");
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
    expect(requests[0]?.url).toBe("https://api-sandbox.direct.yandex.com/json/v5/reports");
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
      mode: "sandbox",
      token: TOKEN,
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
    [58, "Незавершенная регистрация", "", "DIRECT_TOKEN_REVOKED", false],
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
      json({ AddResults: [{ Errors: [{ Code: 6000, Message: "Неконсистентное состояние объекта", Details: "Не заполнены данные для маркировки рекламы (ОРД)" }] }] }),
    ]);
    await expectPlatformError(
      platform.createCampaign({ name: "c", weeklyLimit: 50_000, strategyId: "WB_MAXIMUM_CLICKS", siteMonitoring: true }),
      "ADVERTISER_DATA_REQUIRED",
    );
  });

  it("maps generic per-object errors by code", async () => {
    const { platform } = setup([json({ AddResults: [{ Errors: [{ Code: 5001, Message: "Превышена допустимая длина" }] }] })], {
      resolveAdTarget: () => Promise.resolve({ adGroupId: "301", href: "https://example.ru" }),
    });
    await expectPlatformError(platform.createAd({ campaignId: "101", title: "t", text: "x" }), "DIRECT_ERROR_5001", false);
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
    expect(() => new YandexDirectPlatform({ mode: "sandbox", token: "", logger: () => undefined })).toThrow(/token is required/);
  });
});
