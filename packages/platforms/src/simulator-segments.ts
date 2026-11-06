import { phraseMatches } from "@impuls/core";
import type { Kopecks } from "@impuls/core";
import type { BreakdownDimension, Device, DeviceAdjustments } from "./contract";

/** How an ad's traffic splits by device in the simulator's truth: share of impressions and relative quality. */
export interface DeviceTruth {
  share: number;
  /** Lead rate relative to the ad's average (1 — the same). */
  crFactor?: number;
  /** Click price relative to the ad's average. */
  cpcFactor?: number;
}

/** A search query of the ad's traffic in the simulator's truth. */
export interface QueryTruth {
  text: string;
  share: number;
  crFactor?: number;
}

/** Device shares of an ad without its own (Direct traffic is mostly from phones). */
export const DEFAULT_DEVICES: Readonly<Record<Device, DeviceTruth>> = {
  mobile: { share: 0.6 },
  desktop: { share: 0.35 },
  tablet: { share: 0.05 },
};

export const DEVICES: readonly Device[] = ["mobile", "desktop", "tablet"];

/** One row of a breakdown of entered numbers: a device («mobile») or a search query («маникюр бесплатно»). */
export interface SegmentRow {
  segment: string;
  impressions: number;
  clicks: number;
  leads: number;
  spend: Kopecks;
}

/**
 * How an ad's entered numbers split by device and, for search, by query (simulation-breakdowns): each dimension adds
 * up to the ad's totals on its own, as Direct's separate reports do. A network ad has no query rows.
 */
export interface PeriodSegments {
  device: SegmentRow[];
  query: SegmentRow[];
}

/** One device × query part of an ad's traffic for a given hour's settings. */
export interface SegmentCell {
  device: Device;
  query: string | null;
  /** Share of the ad's base demand that is shown: lowered by bid adjustments, zero for excluded queries. */
  weight: number;
  cr: number;
  costPerClick: number;
}

export interface SegmentInput {
  cr: number;
  costPerClick: Kopecks;
  devices?: Partial<Record<Device, DeviceTruth>>;
  queries?: readonly QueryTruth[];
}

/** A bid adjustment in percent: impressions follow the bid, the click price half as much (design decision 9). */
export const impressionMultiplier = (percent: number): number => Math.max(0, 1 + percent / 100);
export const priceMultiplier = (percent: number): number => Math.max(0.1, 1 + percent / 200);

/** The adjustment a device follows: tablets go with computers, as in Direct. */
export const adjustmentOf = (device: Device, adjustments: DeviceAdjustments): number => (device === "mobile" ? adjustments.mobile : adjustments.desktop);

/**
 * The ad's traffic as device × query cells under the campaign's settings of the hour. Factors are normalized so that
 * without settings the mix has exactly the ad's average lead rate and click price.
 */
export const segmentCells = (input: SegmentInput, adjustments: DeviceAdjustments, negativeKeywords: readonly string[], fallbackQueries: readonly string[]): SegmentCell[] => {
  const deviceTruth = DEVICES.map((device) => ({ device, ...(input.devices?.[device] ?? DEFAULT_DEVICES[device]) }));
  const deviceTotal = deviceTruth.reduce((sum, d) => sum + d.share, 0) || 1;
  const queryTruth: { text: string | null; share: number; crFactor: number }[] =
    input.queries && input.queries.length > 0
      ? input.queries.map((q) => ({ text: q.text, share: q.share, crFactor: q.crFactor ?? 1 }))
      : fallbackQueries.length > 0
        ? fallbackQueries.map((text) => ({ text, share: 1, crFactor: 1 }))
        : [{ text: null, share: 1, crFactor: 1 }];
  const queryTotal = queryTruth.reduce((sum, q) => sum + q.share, 0) || 1;
  const crNorm =
    deviceTruth.reduce((sum, d) => sum + (d.share / deviceTotal) * (d.crFactor ?? 1), 0) * queryTruth.reduce((sum, q) => sum + (q.share / queryTotal) * q.crFactor, 0);
  const cpcNorm = deviceTruth.reduce((sum, d) => sum + (d.share / deviceTotal) * (d.cpcFactor ?? 1), 0);
  const cells: SegmentCell[] = [];
  for (const d of deviceTruth) {
    const percent = adjustmentOf(d.device, adjustments);
    for (const q of queryTruth) {
      const excluded = q.text !== null && negativeKeywords.some((phrase) => phraseMatches(phrase, q.text ?? ""));
      cells.push({
        device: d.device,
        query: q.text,
        weight: excluded ? 0 : (d.share / deviceTotal) * impressionMultiplier(percent) * (q.share / queryTotal),
        cr: (input.cr * (d.crFactor ?? 1) * q.crFactor) / (crNorm || 1),
        costPerClick: ((input.costPerClick * (d.cpcFactor ?? 1)) / (cpcNorm || 1)) * priceMultiplier(percent),
      });
    }
  }
  return cells;
};

/** Whether the hour's settings leave the ad's traffic as its truth says: then the truth is used as is. */
export const isNeutral = (adjustments: DeviceAdjustments, negativeKeywords: readonly string[], queries: readonly (string | null)[]): boolean =>
  adjustments.mobile === 0 && adjustments.desktop === 0 && !queries.some((q) => q !== null && negativeKeywords.some((phrase) => phraseMatches(phrase, q)));

/** The ad's effective demand, lead rate and click price for the hour: the mix of its cells. */
export const effectiveTraffic = (cells: readonly SegmentCell[]): { reach: number; cr: number; costPerClick: Kopecks } => {
  const reach = cells.reduce((sum, c) => sum + c.weight, 0);
  if (reach === 0) return { reach: 0, cr: 0, costPerClick: 1 };
  return {
    reach,
    cr: cells.reduce((sum, c) => sum + c.weight * c.cr, 0) / reach,
    costPerClick: Math.max(1, Math.round(cells.reduce((sum, c) => sum + c.weight * c.costPerClick, 0) / reach)),
  };
};

/** Integer amounts proportional to the weights that add up to `total` exactly (largest remainder). */
export const allocate = (total: number, weights: readonly number[]): number[] => {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => ({ i, rest: v - Math.floor(v) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left--;
  }
  return floors;
};

/** One cell's totals split by the segments of a dimension, with the weights of the hour it was made in. */
export const splitTotals = (
  totals: { impressions: number; clicks: number; leads: number; spend: Kopecks },
  cells: readonly SegmentCell[],
  dimension: BreakdownDimension,
): Map<string, { impressions: number; clicks: number; leads: number; spend: Kopecks }> => {
  const groups = new Map<string, { weight: number; leads: number; spend: number }>();
  for (const cell of cells) {
    const key = dimension === "device" ? cell.device : cell.query;
    if (key === null || cell.weight === 0) continue;
    const g = groups.get(key) ?? { weight: 0, leads: 0, spend: 0 };
    g.weight += cell.weight;
    g.leads += cell.weight * cell.cr;
    g.spend += cell.weight * cell.costPerClick;
    groups.set(key, g);
  }
  const keys = [...groups.keys()];
  const values = [...groups.values()];
  const impressions = allocate(totals.impressions, values.map((g) => g.weight));
  const clicks = allocate(totals.clicks, values.map((g) => g.weight));
  const leads = allocate(totals.leads, values.map((g) => g.leads));
  const spend = allocate(totals.spend, values.map((g) => g.spend));
  return new Map(keys.map((key, i) => [key, { impressions: impressions[i] ?? 0, clicks: clicks[i] ?? 0, leads: leads[i] ?? 0, spend: spend[i] ?? 0 }]));
};
