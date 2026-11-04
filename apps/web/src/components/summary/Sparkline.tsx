import { formatLocalDate, formatRub } from "@/lib/format";

export interface TrendPoint {
  date: string;
  /** The day's cost per lead in kopecks; null when the day has no leads or no report. */
  value: number | null;
  /** A reported day that spent money and brought no lead: a mark at the bottom, never a hidden gap. */
  noLeads: boolean;
}

const WIDTH = 520;
const HEIGHT = 64;

/**
 * The cost per lead of the last days: a reported day with leads is a point, a day that spent without leads is a mark at
 * the bottom that breaks the line, a day without a report is left out (`daily` keeps gaps distinct from zero leads).
 */
export const trendOf = (daily: readonly { date: string; leads: number | null; spend: number }[]): TrendPoint[] => {
  const points = daily.map((day) => ({
    date: day.date,
    value: day.leads !== null && day.leads > 0 ? Math.round(day.spend / day.leads) : null,
    noLeads: day.leads === 0 && day.spend > 0,
    reported: day.leads !== null,
  }));
  // Reports lag: trim only the days without a report at the edges, so the axis reaches the last reported day.
  const first = points.findIndex((p) => p.reported);
  const last = points.findLastIndex((p) => p.reported);
  return first === -1 ? [] : points.slice(first, last + 1).map(({ date, value, noLeads }) => ({ date, value, noLeads }));
};

/**
 * One thin line: the cost of a lead against its goal. No axes or legend — the brief already answers «сколько сейчас»,
 * and this answers «становится лучше или хуже». The SVG stretches to the width; dots and words are HTML, so they keep
 * their size on a phone.
 */
export function Sparkline({ points, goal, goalLabel }: { points: readonly TrendPoint[]; goal: number; goalLabel: "цель" | "ориентир" }) {
  const seen = points.filter((p) => p.value !== null);
  if (seen.length < 2) return null;
  const values = seen.map((p) => p.value as number);
  const low = Math.min(...values, goal);
  const high = Math.max(...values, goal);
  const spread = Math.max(1, high - low);
  const top = low - spread * 0.12;
  const bottom = high + spread * 0.12;
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
  const path = (run: { index: number; value: number }[]): string => run.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.index).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const area = (run: { index: number; value: number }[]): string => {
    const first = run[0];
    const last = run.at(-1);
    return first && last ? `${path(run)} L${x(last.index).toFixed(1)},${HEIGHT} L${x(first.index).toFixed(1)},${HEIGHT} Z` : "";
  };
  const lastSeen = runs.at(-1)?.at(-1);
  const misses = points.flatMap((p, index) => (p.noLeads ? [index] : []));
  const goalY = y(goal);
  const firstDate = points[0]?.date ?? "";
  const lastDate = points.at(-1)?.date ?? "";

  return (
    <figure className="sparkline" data-testid="cost-chart" aria-label={`Цена обращения с ${formatLocalDate(firstDate)} по ${formatLocalDate(lastDate)}, ${goalLabel} ${formatRub(goal)}${misses.length > 0 ? `, дней без обращений: ${misses.length}` : ""}`} role="img">
      <div className="spark-title" aria-hidden="true">
        цена обращения по дням
      </div>
      <div className="spark-plot">
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
        {runs.flatMap((run) => (run.length === 1 && run[0] && run[0] !== lastSeen ? [<i key={`p${run[0].index}`} className="spark-point" style={{ left: pct(x(run[0].index), WIDTH), top: pct(y(run[0].value), HEIGHT) }} />] : []))}
        {lastSeen ? <i className="spark-dot" style={{ left: pct(x(lastSeen.index), WIDTH), top: pct(y(lastSeen.value), HEIGHT) }} /> : null}
        {misses.map((index) => (
          <i key={`m${index}`} className="spark-miss" data-testid="chart-no-leads" title={`${formatLocalDate(points[index]?.date ?? "")}: без обращений`} style={{ left: pct(x(index), WIDTH) }} />
        ))}
        <span className="spark-goal-label" style={{ top: pct(goalY, HEIGHT) }} data-below={goalY < 16 || undefined}>
          {goalLabel} {formatRub(goal)}
        </span>
      </div>
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
