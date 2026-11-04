"use client";

import { useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { formatLocalDate, formatRub, plural } from "@/lib/format";

export interface TrendPoint {
  date: string;
  /** The day's cost per lead in kopecks; null when the day has no leads or no report. */
  value: number | null;
  /** A reported day that spent money and brought no lead: a mark at the bottom, never a hidden gap. */
  noLeads: boolean;
  /** The day's leads and spend, for the day's hint; leads are null for a day without a report. */
  leads: number | null;
  spend: number;
}

const WIDTH = 520;
const HEIGHT = 100;

/**
 * The cost per lead of the last days: a reported day with leads is a point, a day that spent without leads is a mark at
 * the bottom that breaks the line, a day without a report is left out (`daily` keeps gaps distinct from zero leads).
 */
export const trendOf = (daily: readonly { date: string; leads: number | null; spend: number }[]): TrendPoint[] => {
  const points = daily.map((day) => ({
    date: day.date,
    value: day.leads !== null && day.leads > 0 ? Math.round(day.spend / day.leads) : null,
    noLeads: day.leads === 0 && day.spend > 0,
    leads: day.leads,
    spend: day.spend,
  }));
  // Reports lag: trim only the days without a report at the edges, so the axis reaches the last reported day.
  const first = points.findIndex((p) => p.leads !== null);
  const last = points.findLastIndex((p) => p.leads !== null);
  return first === -1 ? [] : points.slice(first, last + 1);
};

/** The day's hint in the analytics spec's words: the price and leads of a day with leads, the spend of one without. */
export const dayHint = (point: TrendPoint): string => {
  const date = formatLocalDate(point.date);
  if (point.value !== null && point.leads !== null) {
    return `${date} · ${formatRub(point.value)} за обращение · ${point.leads} ${plural(point.leads, "обращение", "обращения", "обращений")}`;
  }
  return `${date} · без обращений · потрачено ${formatRub(point.spend)}`;
};

type Pt = { x: number; y: number };

/**
 * A monotone cubic through the points (d3's curveMonotoneX): smooth, yet never above or below its neighbours, so the
 * curve does not draw a price that no day had.
 */
const monotone = (pts: readonly Pt[]): string => {
  const n = pts.length;
  const at = (p: Pt): string => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  if (n === 0) return "";
  if (n < 3) return pts.map((p, i) => `${i === 0 ? "M" : "L"}${at(p)}`).join("");
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const a = pts[i] as Pt;
    const b = pts[i + 1] as Pt;
    h.push(b.x - a.x);
    d.push((b.y - a.y) / (b.x - a.x));
  }
  const m: number[] = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i += 1) {
    const d0 = d[i - 1] as number;
    const d1 = d[i] as number;
    if (d0 * d1 <= 0) continue;
    const p = (d0 * (h[i] as number) + d1 * (h[i - 1] as number)) / ((h[i - 1] as number) + (h[i] as number));
    m[i] = (Math.sign(d0) + Math.sign(d1)) * Math.min(Math.abs(d0), Math.abs(d1), 0.5 * Math.abs(p));
  }
  m[0] = (3 * (d[0] as number) - (m[1] as number)) / 2;
  m[n - 1] = (3 * (d[n - 2] as number) - (m[n - 2] as number)) / 2;
  let path = `M${at(pts[0] as Pt)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const a = pts[i] as Pt;
    const b = pts[i + 1] as Pt;
    const dx = (h[i] as number) / 3;
    path += `C${at({ x: a.x + dx, y: a.y + (m[i] as number) * dx })} ${at({ x: b.x - dx, y: b.y - (m[i + 1] as number) * dx })} ${at(b)}`;
  }
  return path;
};

/**
 * One line: the cost of a lead against its goal. No axes or legend — the brief already answers «сколько сейчас», and
 * this answers «становится лучше или хуже»; a hover, a tap or the arrow keys tell one day's numbers (analytics spec
 * «Подсказка дня на графике цены»). The SVG stretches to the width; dots, words and the hint are HTML, so they keep
 * their size on a phone.
 */
export function Sparkline({ points, goal, goalLabel }: { points: readonly TrendPoint[]; goal: number; goalLabel: "цель" | "ориентир" }) {
  const [active, setActive] = useState<number | null>(null);
  const seen = points.filter((p) => p.value !== null);
  if (seen.length < 2) return null;
  const values = seen.map((p) => p.value as number);
  const low = Math.min(...values, goal);
  const high = Math.max(...values, goal);
  const spread = Math.max(1, high - low);
  const top = low - spread * 0.14;
  const bottom = high + spread * 0.14;
  const x = (index: number): number => (index / Math.max(1, points.length - 1)) * WIDTH;
  const y = (value: number): number => HEIGHT - ((value - top) / (bottom - top)) * HEIGHT;
  const pct = (value: number, of: number): string => `${((value / of) * 100).toFixed(2)}%`;

  // Runs of consecutive days with leads; a day without leads or without a report breaks the line.
  const runs: { index: number; value: number }[][] = [];
  points.forEach((point, index) => {
    if (point.value === null) return;
    const run = runs.at(-1);
    const previous = run?.at(-1);
    if (run && previous && previous.index === index - 1) run.push({ index, value: point.value });
    else runs.push([{ index, value: point.value }]);
  });
  const path = (run: { index: number; value: number }[]): string => monotone(run.map((p) => ({ x: x(p.index), y: y(p.value) })));
  const area = (run: { index: number; value: number }[]): string => {
    const first = run[0];
    const last = run.at(-1);
    return first && last ? `${path(run)} L${x(last.index).toFixed(1)},${HEIGHT} L${x(first.index).toFixed(1)},${HEIGHT} Z` : "";
  };
  const lastSeen = runs.at(-1)?.at(-1);
  const misses = points.flatMap((p, index) => (p.noLeads ? [index] : []));
  // The days a hint can show: the ones drawn as a point or a mark.
  const days = points.flatMap((p, index) => (p.value !== null || p.noLeads ? [index] : []));
  const goalY = y(goal);
  const firstDate = points[0]?.date ?? "";
  const lastDate = points.at(-1)?.date ?? "";
  const current = active !== null ? points[active] : undefined;
  const hint = current ? dayHint(current) : "";
  const share = active !== null ? x(active) / WIDTH : 0;

  const nearest = (event: PointerEvent<HTMLDivElement>): number | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return days.at(-1) ?? null;
    const at = ((event.clientX - rect.left) / rect.width) * Math.max(1, points.length - 1);
    return days.reduce<number | null>((best, index) => (best === null || Math.abs(index - at) < Math.abs(best - at) ? index : best), null);
  };
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const position = active === null ? days.length : days.indexOf(active);
    const next = event.key === "ArrowLeft" ? Math.max(0, position - 1) : Math.min(days.length - 1, position + 1);
    setActive(days[next] ?? null);
  };

  return (
    <figure
      className="sparkline"
      data-testid="cost-chart"
      role="group"
      tabIndex={0}
      aria-label={`Цена обращения с ${formatLocalDate(firstDate)} по ${formatLocalDate(lastDate)}, ${goalLabel} ${formatRub(goal)}${misses.length > 0 ? `, дней без обращений: ${misses.length}` : ""}. Стрелки показывают цифры дня.`}
      onKeyDown={onKey}
      onFocus={() => setActive((value) => value ?? days.at(-1) ?? null)}
      onBlur={() => setActive(null)}
    >
      <div className="spark-title" aria-hidden="true">
        цена обращения по дням
      </div>
      <div
        className="spark-plot"
        data-active={active !== null || undefined}
        onPointerMove={(event) => setActive(nearest(event))}
        onPointerDown={(event) => setActive(nearest(event))}
        onPointerLeave={(event) => {
          // A finger or a pen lifts with a «leave»: its hint stays until the chart loses focus.
          if (event.pointerType !== "touch" && event.pointerType !== "pen") setActive(null);
        }}
      >
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="spark-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="spark-area-top" />
              <stop offset="1" className="spark-area-bottom" />
            </linearGradient>
          </defs>
          <line className="spark-goal" x1="0" y1={goalY} x2={WIDTH} y2={goalY} vectorEffect="non-scaling-stroke" />
          {runs.map((run) => (run.length > 1 ? <path key={`a${run[0]?.index}`} d={area(run)} fill="url(#spark-area)" /> : null))}
          {runs.map((run) => (run.length > 1 ? <path key={`l${run[0]?.index}`} className="spark-line" d={path(run)} vectorEffect="non-scaling-stroke" /> : null))}
        </svg>
        <span className="spark-goal-label" style={{ top: pct(goalY, HEIGHT) }} data-below={goalY < 22 || undefined}>
          {goalLabel} {formatRub(goal)}
        </span>
        {active !== null ? <i className="spark-guide" style={{ left: pct(x(active), WIDTH) }} aria-hidden="true" /> : null}
        {runs.flatMap((run) => (run.length === 1 && run[0] && run[0] !== lastSeen ? [<i key={`p${run[0].index}`} className="spark-point" style={{ left: pct(x(run[0].index), WIDTH), top: pct(y(run[0].value), HEIGHT) }} />] : []))}
        {lastSeen ? <i className="spark-dot" style={{ left: pct(x(lastSeen.index), WIDTH), top: pct(y(lastSeen.value), HEIGHT) }} /> : null}
        {current && current.value !== null && active !== null ? <i className="spark-focus" style={{ left: pct(x(active), WIDTH), top: pct(y(current.value), HEIGHT) }} aria-hidden="true" /> : null}
        {misses.map((index) => (
          <i key={`m${index}`} className="spark-miss" data-testid="chart-no-leads" data-active={index === active || undefined} style={{ left: pct(x(index), WIDTH) }} />
        ))}
        {active !== null ? (
          <span className="spark-tip" data-testid="chart-hint" data-edge={share < 0.18 ? "start" : share > 0.82 ? "end" : undefined} style={{ left: pct(x(active), WIDTH) }} aria-hidden="true">
            {hint}
          </span>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {hint}
      </span>
      <figcaption className="spark-axis" aria-hidden="true">
        <span>{formatLocalDate(firstDate)}</span>
        {misses.length > 0 ? (
          <span className="spark-axis-miss">
            <i className="spark-miss-key" /> без обращений
          </span>
        ) : null}
        <span>{formatLocalDate(lastDate)}</span>
      </figcaption>
    </figure>
  );
}
