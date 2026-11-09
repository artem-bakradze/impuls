"use client";

import type { ReactNode } from "react";
import { formatRub } from "@/lib/format";
import type { SpendCurve } from "@/lib/spend-curve";
import { useDayWords } from "../ui/DayWordsContext";

const WIDTH = 520;
const HEIGHT = 80;
/** The plan's dot apart from the spent dot, in shares of the chart's height; closer, the two read as one and it is left out. */
const PLAN_DOT_GAP = 0.1;

/**
 * The month's money against the even plan (analytics spec «Сводка»), on a light plate: a solid line of what was spent by
 * each day with the last day's name at its dot, a dashed «ровный план» from nothing to the whole budget at the period's
 * end, and the plan's dot on the same day while the two dots stand apart. Under it the period's first and last days with
 * the pace in words between them. The SVG stretches to the width; dots and words are HTML, so they keep their size.
 */
export function SpendChart({ curve, tone, pace = null }: { curve: SpendCurve; tone?: "warning" | "danger" | undefined; pace?: ReactNode }) {
  const words = useDayWords();
  const last = curve.points.at(-1);
  if (last === undefined) return null;
  const plan = Math.round(curve.budget * last.at);
  const top = Math.max(curve.budget, last.spent);
  const x = (at: number): number => at * WIDTH;
  const y = (spent: number): number => HEIGHT - (spent / top) * HEIGHT;
  const pct = (value: number, of: number): string => `${((value / of) * 100).toFixed(2)}%`;
  const line = `M0,${HEIGHT}${curve.points.map((p) => `L${x(p.at).toFixed(1)},${y(p.spent).toFixed(1)}`).join("")}`;
  const area = `${line}L${x(last.at).toFixed(1)},${HEIGHT}Z`;
  const planY = y(curve.budget);
  const planDot = Math.abs(plan - last.spent) / top >= PLAN_DOT_GAP;
  // The day's name sits right of its dot, or left of it near the period's end.
  const late = last.at > 0.7;

  return (
    <figure className="spend-chart" data-tone={tone} data-testid="spend-chart">
      <div
        className="spend-plate"
        role="img"
        aria-label={`Потрачено ${formatRub(last.spent)} из ${formatRub(curve.budget)}. По ровному плану ${words.by(last.date)} было бы ${formatRub(plan)}.`}
      >
        <div className="spend-plot" aria-hidden="true">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
            <line className="spend-plan" x1="0" y1={HEIGHT} x2={WIDTH} y2={planY} vectorEffect="non-scaling-stroke" />
            <path className="spend-area" d={area} />
            <path className="spend-line" d={line} vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="spend-plan-label">ровный план</span>
          {planDot ? <i className="spend-plan-dot" style={{ left: pct(x(last.at), WIDTH), top: pct(y(plan), HEIGHT) }} /> : null}
          <i className="spend-dot" style={{ left: pct(x(last.at), WIDTH), top: pct(y(last.spent), HEIGHT) }} />
          <span className="spend-day" data-late={late || undefined} style={{ left: pct(x(last.at), WIDTH), top: pct(y(last.spent), HEIGHT) }}>
            {words.date(last.date)}
          </span>
        </div>
      </div>
      <figcaption className="spend-axis">
        <span aria-hidden="true">{words.date(curve.from)}</span>
        {pace !== null ? <span className="spend-pace">{pace}</span> : null}
        <span aria-hidden="true">{words.date(curve.to)}</span>
      </figcaption>
    </figure>
  );
}
