import type { BreakdownAnswer, BreakdownRowView } from "@impuls/agent";
import { addDays, costPerLead, factKey, filterQueries, phraseWords, querySegmentId, SEGMENT_VERDICT_TEXT, segmentVerdict, toLocalDate } from "@impuls/core";
import type { AdjustableDevice, Command, DirectionAnalystState, Fact, InsightFact, Kopecks, LocalDate } from "@impuls/core";
import type { AdPlatform, BreakdownDimension, BreakdownRow, Device, DeviceAdjustments } from "@impuls/platforms";
import type { ChangeEntry, DirectionRecord, Snapshot } from "./store";

/** Commands of the analyst levers (add-agent-analyst-stage1). */
export type AnalystCommand = Extract<Command, { type: "AddNegativeKeywords" | "RemoveNegativeKeywords" | "SetDeviceAdjustment" }>;

export const isAnalystCommand = (command: Command): command is AnalystCommand =>
  command.type === "AddNegativeKeywords" || command.type === "RemoveNegativeKeywords" || command.type === "SetDeviceAdjustment";

/** A breakdown covers the same 14 days as the snapshot's stats, today included. */
export const BREAKDOWN_DAYS = 14;

export const breakdownPeriod = (today: LocalDate): { from: LocalDate; to: LocalDate } => ({ from: addDays(today, -(BREAKDOWN_DAYS - 1)), to: today });

export const ADJUSTABLE_DEVICES: readonly AdjustableDevice[] = ["mobile", "desktop"];

/** History snapshot key of a device's adjustment. */
export const adjustmentKey = (device: AdjustableDevice): "mobileAdjustment" | "desktopAdjustment" => (device === "mobile" ? "mobileAdjustment" : "desktopAdjustment");

/** History snapshot keys of the traffic settings. */
export const TRAFFIC_KEYS: readonly string[] = ["negativeKeywords", ...ADJUSTABLE_DEVICES.map(adjustmentKey)];

/** A phrase as compared everywhere: lowercase words, «ё» as «е», single spaces. */
export const normalizePhrase = (phrase: string): string => phraseWords(phrase).join(" ");

/** Phrases of `phrases` that `base` does not have, compared by normalized form. */
export const phrasesMissing = (phrases: readonly string[], base: readonly string[]): string[] => {
  const have = new Set(base.map(normalizePhrase));
  return phrases.filter((p) => !have.has(normalizePhrase(p)));
};

/** History fields of negative phrases (JSON, sorted, so equal lists compare equal) and adjustments. */
export const trafficSnapshot = (settings: { negativeKeywords: readonly string[]; deviceAdjustments: DeviceAdjustments }): Snapshot => ({
  negativeKeywords: JSON.stringify([...settings.negativeKeywords].sort()),
  mobileAdjustment: settings.deviceAdjustments.mobile,
  desktopAdjustment: settings.deviceAdjustments.desktop,
});

export const snapshotPhrases = (snapshot: Snapshot): string[] =>
  typeof snapshot.negativeKeywords === "string" ? (JSON.parse(snapshot.negativeKeywords) as string[]) : [];

/** Traffic fields of `before` after the command, for recovering an entry left pending. */
export const desiredTraffic = (before: Snapshot, command: AnalystCommand): Snapshot => {
  const phrases = snapshotPhrases(before);
  switch (command.type) {
    case "AddNegativeKeywords":
      return { ...before, negativeKeywords: JSON.stringify([...phrases, ...phrasesMissing(command.phrases, phrases)].sort()) };
    case "RemoveNegativeKeywords": {
      const removed = new Set(command.phrases.map(normalizePhrase));
      return { ...before, negativeKeywords: JSON.stringify(phrases.filter((p) => !removed.has(normalizePhrase(p))).sort()) };
    }
    case "SetDeviceAdjustment":
      return { ...before, [adjustmentKey(command.device)]: command.percent };
  }
};

/** Devices in the owner's words: the segment's name and the object of its facts. */
export const DEVICE_WORDS: Readonly<Record<Device, { name: string; from: string }>> = {
  mobile: { name: "телефоны", from: "с телефонов" },
  desktop: { name: "компьютеры", from: "с компьютеров" },
  tablet: { name: "планшеты", from: "с планшетов" },
};

const DEVICE_ORDER: readonly string[] = ["mobile", "desktop", "tablet"];

const toRub = (kopecks: number): number => Math.round(kopecks / 100);

/**
 * A breakdown as the agent reads it and the facts it adds to the turn's catalog (design decisions 1, 2 and 6): search
 * queries pass the privacy filter first, so a hidden query never becomes a fact; the verdict is the service's.
 * `numbers` are other values the agent may cite: each segment's share of the direction's spend in percent.
 */
export const breakdownForAgent = (input: {
  direction: DirectionRecord;
  /** The direction in the owner's words: «реклама в поиске». */
  label: string;
  dimension: BreakdownDimension;
  rows: readonly BreakdownRow[];
  goal: Kopecks;
}): { answer: Extract<BreakdownAnswer, { status: "ok" }>; facts: InsightFact[]; numbers: Fact[] } => {
  const { direction, label, dimension, goal } = input;
  const directionId = direction.id;
  const total = input.rows.reduce((sum, r) => sum + r.spend, 0);
  const { rows, hidden } =
    dimension === "query"
      ? filterQueries(input.rows)
      : { rows: [...input.rows].sort((a, b) => DEVICE_ORDER.indexOf(a.segment) - DEVICE_ORDER.indexOf(b.segment)), hidden: 0 };
  const facts: InsightFact[] = [];
  const numbers: Fact[] = [];
  const views: BreakdownRowView[] = rows.map((row) => {
    const device = DEVICE_WORDS[row.segment as Device];
    const segmentId = dimension === "device" ? row.segment : querySegmentId(row.segment);
    const object = `${label}, ${dimension === "device" ? (device?.from ?? row.segment) : `запрос «${row.segment}»`}`;
    const cpl = costPerLead(row);
    const add = (metric: InsightFact["metric"], value: number, unit: InsightFact["unit"]) =>
      facts.push({ key: factKey.segment(directionId, dimension, segmentId, metric), object, metric, period: "14d", value, unit });
    add("spend", toRub(row.spend), "rub");
    add("leads", row.leads, "count");
    add("clicks", row.clicks, "count");
    add("impressions", row.impressions, "count");
    if (cpl !== null) add("cost_per_lead", toRub(cpl), "rub");
    if (total > 0) numbers.push({ kind: "percent", value: Math.round((row.spend / total) * 100) });
    return {
      segment: dimension === "device" ? (device?.name ?? row.segment) : row.segment,
      factKeyPrefix: `segment:${directionId}:${dimension}:${segmentId}`,
      impressions: row.impressions,
      clicks: row.clicks,
      spendRub: toRub(row.spend),
      leads: row.leads,
      costPerLeadRub: cpl === null ? null : toRub(cpl),
      verdict: SEGMENT_VERDICT_TEXT[segmentVerdict(row, goal)],
    };
  });
  const context =
    dimension === "query"
      ? { keywords: [...direction.keywords], negativeKeywords: [...direction.negativeKeywords] }
      : {
          adjustments: {
            mobile: { percent: direction.deviceAdjustments.mobile, changedOn: direction.deviceAdjustedOn.mobile },
            desktop: { percent: direction.deviceAdjustments.desktop, changedOn: direction.deviceAdjustedOn.desktop },
          },
        };
  for (const percent of [direction.deviceAdjustments.mobile, direction.deviceAdjustments.desktop]) {
    if (dimension === "device") numbers.push({ kind: "percent", value: Math.abs(percent) });
  }
  return { answer: { status: "ok", directionId, dimension, days: BREAKDOWN_DAYS, rows: views, hidden, ...context }, facts, numbers };
};

/**
 * The guard's view of one direction's analyst levers at execution time (design decision 4): its key phrases, current
 * settings, and a fresh breakdown from the platform — never the agent's turn cache.
 */
export const loadAnalystState = async (
  platform: AdPlatform,
  direction: DirectionRecord,
  command: AnalystCommand,
  input: { today: LocalDate; timeZone: string; changes: readonly ChangeEntry[] },
): Promise<DirectionAnalystState> => {
  const { from, to } = breakdownPeriod(input.today);
  const dimension = command.type === "SetDeviceAdjustment" ? "device" : "query";
  const rows = command.type === "RemoveNegativeKeywords" ? [] : await platform.getBreakdown([direction.platformCampaignId], from, to, dimension);
  const negativeAddedToday = input.changes
    .filter((c) => c.objectId === direction.id && c.actor === "agent" && c.status === "applied" && toLocalDate(c.createdAt, input.timeZone) === input.today)
    .reduce((sum, c) => sum + (c.action.type === "AddNegativeKeywords" ? c.action.phrases.length : 0), 0);
  return {
    keywords: direction.keywords,
    negativeKeywords: direction.negativeKeywords,
    deviceAdjustments: direction.deviceAdjustments,
    deviceAdjustedOn: direction.deviceAdjustedOn,
    negativeAddedToday,
    queries: dimension === "query" ? rows : [],
    devices: dimension === "device" ? rows : [],
  };
};
