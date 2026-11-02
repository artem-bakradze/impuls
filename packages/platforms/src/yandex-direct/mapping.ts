import type { Channel, Kopecks, LocalDate, ObjectStatus } from "@impuls/core";
import { PlatformError } from "../contract";
import type { BreakdownDimension, BreakdownRow, ChangeArea, DailyStatRow, Device, ModerationStatus, PlatformAd, PlatformCampaign } from "../contract";
import { mapDirectError } from "./errors";
import type { JsonRecord } from "./client";

// --- Money ---

/** Direct JSON API money is "micros": currency units * 1 000 000, so 1 kopeck = 10 000 micros. */
export const MICROS_PER_KOPECK = 10_000;

export const kopecksToMicros = (kopecks: Kopecks): number => {
  if (!Number.isInteger(kopecks)) {
    throw new PlatformError("INVALID_MONEY", `Money must be integer kopecks, got ${kopecks}`, false);
  }
  return kopecks * MICROS_PER_KOPECK;
};

export const microsToKopecks = (micros: number): Kopecks => Math.round(micros / MICROS_PER_KOPECK);

/** Reports with `returnMoneyInMicros: false` return rubles with two decimals ("123.45"). */
export const rublesTextToKopecks = (text: string): Kopecks => Math.round(Number(text) * 100);

// --- Strategies ---

export const STRATEGY_WB_MAXIMUM_CLICKS = "WB_MAXIMUM_CLICKS";
export const STRATEGY_AVERAGE_CPA = "AVERAGE_CPA";

export interface AverageCpaParams {
  /** Target average cost of a conversion (ЦСО). */
  averageCpa: Kopecks;
  /** Metrica goal id. */
  goalId: number;
}

export type StrategyInput =
  | { strategyId: typeof STRATEGY_WB_MAXIMUM_CLICKS; weeklyLimit: Kopecks }
  | ({ strategyId: typeof STRATEGY_AVERAGE_CPA; weeklyLimit: Kopecks } & AverageCpaParams);

/** Builds one side (`Search` or `Network`) of `TextCampaign.BiddingStrategy`; both sides use the same shape. */
export const buildSideStrategy = (input: StrategyInput): JsonRecord => {
  if (input.strategyId === STRATEGY_WB_MAXIMUM_CLICKS) {
    return {
      BiddingStrategyType: STRATEGY_WB_MAXIMUM_CLICKS,
      WbMaximumClicks: { WeeklySpendLimit: kopecksToMicros(input.weeklyLimit) },
    };
  }
  return {
    BiddingStrategyType: STRATEGY_AVERAGE_CPA,
    AverageCpa: {
      AverageCpa: kopecksToMicros(input.averageCpa),
      GoalId: input.goalId,
      WeeklySpendLimit: kopecksToMicros(input.weeklyLimit),
    },
  };
};

const SERVING_OFF = { BiddingStrategyType: "SERVING_OFF" };

/** A direction shows on one channel only: the other side of the campaign is switched off. */
export const buildBiddingStrategy = (channel: Channel, input: StrategyInput): JsonRecord =>
  channel === "search"
    ? { Search: buildSideStrategy(input), Network: SERVING_OFF }
    : { Search: SERVING_OFF, Network: buildSideStrategy(input) };

/** Which side of `BiddingStrategy` is serving; the other one is `SERVING_OFF`. */
export const servingChannel = (raw: JsonRecord): Channel => {
  const strategy = record(record(raw.TextCampaign).BiddingStrategy);
  return text(record(strategy.Search).BiddingStrategyType) === "SERVING_OFF" ? "network" : "search";
};

const servingStrategy = (raw: JsonRecord): JsonRecord => {
  const strategy = record(record(raw.TextCampaign).BiddingStrategy);
  return record(servingChannel(raw) === "search" ? strategy.Search : strategy.Network);
};

// --- Schedule ---

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

/**
 * Builds `TimeTargeting` from a display schedule such as "Пн–Пт 10:00–22:00" or "10:00–22:00" (every day).
 * "00:00–24:00" is round the clock; a closing hour before the opening one runs past midnight, and those night hours
 * are switched on for the same days (an approximation: Direct has no «next day» hours).
 * Each `Schedule.Items` entry is "<day 1–7>,<24 bid percentages>"; 0 switches the hour off, 100 keeps the bid.
 * VERIFY: item format against the contract test (Direct docs: Campaigns.add, TimeTargeting).
 */
export const buildTimeTargeting = (schedule: string): JsonRecord => {
  const match = /^(?:(Пн|Вт|Ср|Чт|Пт|Сб|Вс)[–-](Пн|Вт|Ср|Чт|Пт|Сб|Вс)\s+)?(\d{2}):00[–-](\d{2}):00$/u.exec(schedule.trim());
  if (!match) {
    throw new PlatformError("INVALID_SCHEDULE", `Unsupported schedule format: ${schedule}`, false);
  }
  const [, fromDay, toDay, fromHour, toHour] = match;
  const first = fromDay ? WEEKDAYS.indexOf(fromDay as (typeof WEEKDAYS)[number]) : 0;
  const last = toDay ? WEEKDAYS.indexOf(toDay as (typeof WEEKDAYS)[number]) : 6;
  const open = Number(fromHour);
  const close = Number(toHour);
  if (first > last || open === close || open > 23 || close > 24) {
    throw new PlatformError("INVALID_SCHEDULE", `Unsupported schedule range: ${schedule}`, false);
  }
  const items = WEEKDAYS.map((_, day) => {
    const on = day >= first && day <= last;
    const overnight = close < open;
    const hours = Array.from({ length: 24 }, (_, hour) => (on && (overnight ? hour >= open || hour < close : hour >= open && hour < close) ? 100 : 0));
    return [day + 1, ...hours].join(",");
  });
  return { Schedule: { Items: items }, ConsiderWorkingWeekends: "YES" };
};

// --- Landing pages ---

/**
 * Adds the service's UTM tags to the landing URL. Direct substitutes `{campaign_id}` and `{ad_id}` when the ad is
 * clicked, so leads in Metrica are matched to the direction and the ad (platform-integration spec).
 */
export const withUtm = (landingUrl: string): string => {
  let url: URL;
  try {
    url = new URL(landingUrl);
  } catch {
    throw new PlatformError("INVALID_LANDING_URL", `Landing URL is not a valid URL: ${landingUrl}`, false);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PlatformError("INVALID_LANDING_URL", `Landing URL must be http(s): ${landingUrl}`, false);
  }
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
    url.searchParams.delete(key);
  }
  // Placeholders must stay unescaped, so they are appended as text.
  const tags = "utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}&utm_content={ad_id}";
  return `${url.origin}${url.pathname}${url.search ? `${url.search}&` : "?"}${tags}${url.hash}`;
};

/** Network groups without phrases are shown by autotargeting. VERIFY: keyword text against the contract test. */
export const AUTOTARGETING_KEYWORD = "---autotargeting";

export const buildSettings = (siteMonitoring: boolean): JsonRecord[] => [
  { Option: "ENABLE_SITE_MONITORING", Value: siteMonitoring ? "YES" : "NO" },
];

// --- JSON reading helpers ---

const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);

export const records = (value: unknown): JsonRecord[] => (Array.isArray(value) ? value.filter(isRecord) : []);

const record = (value: unknown): JsonRecord => (isRecord(value) ? value : {});

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const idText = (value: unknown): string => (typeof value === "number" || typeof value === "string" ? String(value) : "");

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

// --- Campaigns ---

/** Campaign `State`: SUSPENDED/ENDED/ARCHIVED/CONVERTED → paused; ON/OFF (OFF = not serving for other reasons, e.g. no money) → active. */
export const campaignStateToStatus = (state: string): ObjectStatus =>
  state === "ON" || state === "OFF" ? "active" : "paused";

/**
 * Reads a campaign from `Campaigns.get` with `TextCampaignFieldNames: ["BiddingStrategy", "Settings"]`.
 * A strategy without a weekly limit (set in the cabinet) is reported as `Infinity`, so budget-guard
 * treats it as above any allowed limit instead of as "zero spend".
 */
export const parseCampaign = (raw: JsonRecord): PlatformCampaign => {
  const textCampaign = record(raw.TextCampaign);
  const serving = servingStrategy(raw);
  const strategyId = text(serving.BiddingStrategyType);
  const params = strategyId === STRATEGY_AVERAGE_CPA ? record(serving.AverageCpa) : record(serving.WbMaximumClicks);
  const limitMicros = num(params.WeeklySpendLimit);
  const monitoring = records(textCampaign.Settings).find((s) => s.Option === "ENABLE_SITE_MONITORING");
  return {
    id: idText(raw.Id),
    name: text(raw.Name),
    status: campaignStateToStatus(text(raw.State)),
    weeklyLimit: limitMicros === null ? Number.POSITIVE_INFINITY : microsToKopecks(limitMicros),
    strategyId,
    siteMonitoring: monitoring?.Value === "YES",
  };
};

/** Current AVERAGE_CPA parameters, needed to rebuild the strategy when only the limit changes. */
export const parseAverageCpaParams = (raw: JsonRecord): AverageCpaParams | null => {
  const params = record(servingStrategy(raw).AverageCpa);
  const averageCpa = num(params.AverageCpa);
  const goalId = num(params.GoalId);
  return averageCpa === null || goalId === null ? null : { averageCpa: microsToKopecks(averageCpa), goalId };
};

// --- Ads ---

/** Ad `State`: SUSPENDED/ARCHIVED → paused; ON/OFF/OFF_BY_MONITORING → active (not stopped by us). */
export const adStateToStatus = (state: string): ObjectStatus =>
  state === "SUSPENDED" || state === "ARCHIVED" ? "paused" : "active";

/** Ad `Status`: ACCEPTED/PREACCEPTED → accepted, REJECTED → rejected, DRAFT/MODERATION/UNKNOWN → pending. */
export const adStatusToModeration = (status: string): ModerationStatus => {
  if (status === "ACCEPTED" || status === "PREACCEPTED") {
    return "accepted";
  }
  if (status === "REJECTED") {
    return "rejected";
  }
  return "pending";
};

export const parseAd = (raw: JsonRecord): PlatformAd => {
  const textAd = record(raw.TextAd);
  const moderation = adStatusToModeration(text(raw.Status));
  const clarification = text(raw.StatusClarification);
  return {
    id: idText(raw.Id),
    campaignId: idText(raw.CampaignId),
    status: adStateToStatus(text(raw.State)),
    title: text(textAd.Title),
    text: text(textAd.Text),
    moderation,
    rejectionReason: moderation === "rejected" ? clarification || null : null,
  };
};

// --- Action results ---

/**
 * Checks `AddResults`/`UpdateResults`/`SuspendResults`/... of a single-object call and returns the object id.
 * Per-object errors are mapped like request-level ones; warnings (e.g. 10020 "already suspended") are ignored.
 */
export const singleActionResult = (result: JsonRecord, key: string): string => {
  const item = records(result[key])[0];
  if (!item) {
    throw new PlatformError("DIRECT_INVALID_RESPONSE", `Direct response has no ${key}`, false);
  }
  const error = records(item.Errors)[0];
  if (error) {
    throw mapDirectError({ code: Number(error.Code), message: text(error.Message), detail: text(error.Details) });
  }
  const id = idText(item.Id);
  if (!id) {
    throw new PlatformError("DIRECT_INVALID_RESPONSE", `Direct ${key} item has no Id`, false);
  }
  return id;
};

/** Checks a single action result that carries no single `Id` (`BidModifiers.add` returns `Ids`). */
export const checkActionResult = (result: JsonRecord, key: string): void => {
  const item = records(result[key])[0];
  if (!item) {
    throw new PlatformError("DIRECT_INVALID_RESPONSE", `Direct response has no ${key}`, false);
  }
  const error = records(item.Errors)[0];
  if (error) {
    throw mapDirectError({ code: Number(error.Code), message: text(error.Message), detail: text(error.Details) });
  }
};

// --- Changes ---

/** Direct expects `YYYY-MM-DDThh:mm:ssZ` without milliseconds; truncating keeps the check inclusive. */
export const toDirectTimestamp = (instant: Date): string => instant.toISOString().replace(/\.\d{3}Z$/, "Z");

const CHANGE_AREAS: ReadonlySet<string> = new Set<ChangeArea>(["SELF", "CHILDREN", "STAT"]);

export const parseChangedCampaigns = (result: JsonRecord, campaignIds: readonly string[]): { campaignId: string; areas: ChangeArea[] }[] => {
  const wanted = new Set(campaignIds);
  return records(result.Campaigns)
    .map((c) => ({
      campaignId: idText(c.CampaignId),
      areas: (Array.isArray(c.ChangesIn) ? c.ChangesIn : []).filter((a): a is ChangeArea => typeof a === "string" && CHANGE_AREAS.has(a)),
    }))
    .filter((c) => wanted.has(c.campaignId) && c.areas.length > 0);
};

// --- Reports ---

export const REPORT_FIELDS = ["Date", "CampaignId", "AdId", "Impressions", "Clicks", "Cost", "Conversions"] as const;

/** Stable FNV-1a hash: offline report names must be unique per parameter set. */
const fnv1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const buildStatsReportParams = (campaignIds: readonly string[], from: LocalDate, to: LocalDate): JsonRecord => {
  const params: JsonRecord = {
    SelectionCriteria: {
      DateFrom: from,
      DateTo: to,
      Filter: [{ Field: "CampaignId", Operator: "IN", Values: [...campaignIds] }],
    },
    // Design decision 9: AUTO matches the cabinet default.
    AttributionModels: ["AUTO"],
    FieldNames: [...REPORT_FIELDS],
    ReportType: "CUSTOM_REPORT",
    DateRangeType: "CUSTOM_DATE",
    Format: "TSV",
    IncludeVAT: "YES",
  };
  return { ...params, ReportName: `impuls-stats-${fnv1a(JSON.stringify(params))}` };
};

const count = (value: string): number => (value === "--" || value === "" ? 0 : Number(value));

/**
 * Reports for a breakdown (add-agent-analyst-stage1 design decision 5): devices from `CUSTOM_REPORT` with `Device`,
 * queries from `SEARCH_QUERY_PERFORMANCE_REPORT` with `Query`, with the same attribution and VAT as the daily stats.
 */
export const buildBreakdownReportParams = (campaignIds: readonly string[], from: LocalDate, to: LocalDate, dimension: BreakdownDimension): JsonRecord => {
  const params: JsonRecord = {
    SelectionCriteria: {
      DateFrom: from,
      DateTo: to,
      Filter: [{ Field: "CampaignId", Operator: "IN", Values: [...campaignIds] }],
    },
    AttributionModels: ["AUTO"],
    FieldNames: ["CampaignId", dimension === "device" ? "Device" : "Query", "Impressions", "Clicks", "Cost", "Conversions"],
    ReportType: dimension === "device" ? "CUSTOM_REPORT" : "SEARCH_QUERY_PERFORMANCE_REPORT",
    DateRangeType: "CUSTOM_DATE",
    Format: "TSV",
    IncludeVAT: "YES",
  };
  return { ...params, ReportName: `impuls-${dimension}-${fnv1a(JSON.stringify(params))}` };
};

/** Direct device values; Smart TV counts with computers, as Direct's computer adjustment does. */
const DIRECT_DEVICES: Readonly<Record<string, Device>> = { MOBILE: "mobile", DESKTOP: "desktop", TABLET: "tablet", SMART_TV: "desktop" };

/** Parses a breakdown TSV into rows per campaign and segment; rows without a segment ("--") are skipped. */
export const parseBreakdownTsv = (tsv: string, dimension: BreakdownDimension): BreakdownRow[] => {
  const field = dimension === "device" ? "Device" : "Query";
  const lines = tsv.split(/\r?\n/).filter((line) => line.length > 0);
  const headerIndex = lines.findIndex((line) => line.split("\t").includes("CampaignId"));
  if (headerIndex < 0) {
    throw new PlatformError("DIRECT_INVALID_RESPONSE", "Direct report has no column header line", false);
  }
  const columns = (lines[headerIndex] ?? "").split("\t");
  const index = (name: string): number => {
    const i = columns.indexOf(name);
    if (i < 0) {
      throw new PlatformError("DIRECT_INVALID_RESPONSE", `Direct report has no ${name} column`, false);
    }
    return i;
  };
  const at = { campaignId: index("CampaignId"), segment: index(field), impressions: index("Impressions"), clicks: index("Clicks"), cost: index("Cost"), conversions: index("Conversions") };
  const rows = new Map<string, BreakdownRow>();
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.startsWith("Total rows")) continue;
    const cells = line.split("\t");
    const cell = (i: number): string => cells[i] ?? "";
    const raw = cell(at.segment);
    const segment = dimension === "device" ? DIRECT_DEVICES[raw] : raw === "--" ? undefined : raw;
    if (segment === undefined || segment === "") continue;
    const key = `${cell(at.campaignId)}|${segment}`;
    const row = rows.get(key) ?? { campaignId: cell(at.campaignId), segment, impressions: 0, clicks: 0, leads: 0, spend: 0 };
    row.impressions += count(cell(at.impressions));
    row.clicks += count(cell(at.clicks));
    row.leads += count(cell(at.conversions));
    row.spend += cell(at.cost) === "--" ? 0 : rublesTextToKopecks(cell(at.cost));
    rows.set(key, row);
  }
  return [...rows.values()];
};

/** A bid modifier of Direct is a percent of the bid (100 — unchanged); the contract keeps the change (0 — none). */
export const bidModifierToPercent = (modifier: number): number => modifier - 100;
export const percentToBidModifier = (percent: number): number => 100 + percent;

/**
 * Parses a Reports TSV: optional title line, the column header line, data rows and an optional
 * "Total rows: N" summary. "--" (no data) is read as 0. Rows without an ad id ("--") keep an empty `adId`.
 */
export const parseStatsTsv = (tsv: string): DailyStatRow[] => {
  const lines = tsv.split(/\r?\n/).filter((line) => line.length > 0);
  const headerIndex = lines.findIndex((line) => line.split("\t").includes("CampaignId"));
  if (headerIndex < 0) {
    throw new PlatformError("DIRECT_INVALID_RESPONSE", "Direct report has no column header line", false);
  }
  const columns = (lines[headerIndex] ?? "").split("\t");
  const index = (name: (typeof REPORT_FIELDS)[number]): number => {
    const i = columns.indexOf(name);
    if (i < 0) {
      throw new PlatformError("DIRECT_INVALID_RESPONSE", `Direct report has no ${name} column`, false);
    }
    return i;
  };
  const at = {
    date: index("Date"),
    campaignId: index("CampaignId"),
    adId: index("AdId"),
    impressions: index("Impressions"),
    clicks: index("Clicks"),
    cost: index("Cost"),
    conversions: index("Conversions"),
  };
  return lines
    .slice(headerIndex + 1)
    .filter((line) => !line.startsWith("Total rows"))
    .map((line) => {
      const cells = line.split("\t");
      const cell = (i: number): string => cells[i] ?? "";
      const adId = cell(at.adId);
      return {
        date: cell(at.date),
        campaignId: cell(at.campaignId),
        adId: adId === "--" ? "" : adId,
        impressions: count(cell(at.impressions)),
        clicks: count(cell(at.clicks)),
        leads: count(cell(at.conversions)),
        spend: cell(at.cost) === "--" ? 0 : rublesTextToKopecks(cell(at.cost)),
      };
    });
};
