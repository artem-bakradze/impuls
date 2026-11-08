"use client";

import { formatRub } from "@/lib/format";
import type { SpendCurve } from "@/lib/spend-curve";
import { useDayWords } from "../ui/DayWordsContext";

const WIDTH = 520;
const HEIGHT = 80;
/** The plan's dot apart from the spent dot, in shares of the chart's height; closer, the two read as one and it is left out. */
const PLAN_DOT_GAP = 0.1;

/**
 * The month's money against the even plan (analytics spec «Сводка»): a solid line of what was spent by each day, a dashed
 * plan from nothing to the whole budget at the period's end, and on the last day with numbers two dots — spent and the
 * plan by then — so the gap between them reads at a glance; while they would overlap, only the spent one. No axes or
 * legend: the sum is over it and the pace in words under it. The SVG stretches to the width; dots and words are HTML, so they keep their size on a phone.
 */
export function SpendChart({ curve, tone }: { curve: SpendCurve; tone?: "warning" | "danger" | undefined }) {
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

  return (
    <figure
      className="spend-chart"
      data-tone={tone}
      data-testid="spend-chart"
      role="img"
      aria-label={`Потрачено ${formatRub(last.spent)} из ${formatRub(curve.budget)}. По ровному плану ${words.by(last.date)} было бы ${formatRub(plan)}.`}
    >
      <div className="spend-plot" aria-hidden="true">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
          <line className="spend-plan" x1="0" y1={HEIGHT} x2={WIDTH} y2={planY} vectorEffect="non-scaling-stroke" />
          <path className="spend-area" d={area} />
          <path className="spend-line" d={line} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="spend-plan-label" style={{ top: pct(planY, HEIGHT) }}>
          план
        </span>
        {planDot ? <i className="spend-plan-dot" style={{ left: pct(x(last.at), WIDTH), top: pct(y(plan), HEIGHT) }} /> : null}
        <i className="spend-dot" style={{ left: pct(x(last.at), WIDTH), top: pct(y(last.spent), HEIGHT) }} />
      </div>
      <figcaption className="spend-axis" aria-hidden="true">
        <span>{words.date(curve.from)}</span>
        <span>{words.date(curve.to)}</span>
      </figcaption>
    </figure>
  );
}
