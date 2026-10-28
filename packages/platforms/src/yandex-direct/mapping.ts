import type { Kopecks, LocalDate, ObjectStatus } from "@impuls/core";
import { PlatformError } from "../contract";
import type { ChangeArea, DailyStatRow, ModerationStatus, PlatformAd, PlatformCampaign } from "../contract";
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

/** Builds `TextCampaign.BiddingStrategy.Search`. */
export const buildSearchStrategy = (input: StrategyInput): JsonRecord => {
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

/**
 * Campaigns are search-only for now: the contract has no channel, so the network part is switched off.
 * Directions with the "Сайты-партнёры" channel need a contract extension (raise with the spec owner).
 */
export const buildBiddingStrategy = (input: StrategyInput): JsonRecord => ({
  Search: buildSearchStrategy(input),
  Network: { BiddingStrategyType: "SERVING_OFF" },
});

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
  const search = record(record(textCampaign.BiddingStrategy).Search);
  const strategyId = text(search.BiddingStrategyType);
  const params = strategyId === STRATEGY_AVERAGE_CPA ? record(search.AverageCpa) : record(search.WbMaximumClicks);
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
  const search = record(record(record(raw.TextCampaign).BiddingStrategy).Search);
  const params = record(search.AverageCpa);
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
