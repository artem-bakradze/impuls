import { formatLocalDate, formatRub } from "@/lib/format";

export interface TrendPoint {
  date: string;
  /** The day's cost per lead in kopecks; null when the day has no leads or no report. */
  value: number | null;
}

/**
 * One thin line: the cost of a lead against its goal. No axes, legend or bars — the brief already answers
 * «сколько сейчас», and this answers «становится лучше или хуже».
 */
export function Sparkline({ points, goal, goalLabel }: { points: readonly TrendPoint[]; goal: number; goalLabel: "цель" | "ориентир" }) {
  const seen = points.filter((p) => p.value !== null);
  if (seen.length < 2) return null;
  const width = 520;
  const height = 64;
  const values = seen.map((p) => p.value as number);
  const low = Math.min(...values, goal);
  const high = Math.max(...values, goal);
  const spread = Math.max(1, high - low);
  const top = low - spread * 0.12;
  const bottom = high + spread * 0.12;
  const x = (index: number): number => (index / Math.max(1, points.length - 1)) * width;
  const y = (value: number): number => height - ((value - top) / (bottom - top)) * height;

  let line = "";
  let firstIndex = -1;
  let lastIndex = -1;
  let lastValue: number | null = null;
  points.forEach((point, index) => {
    if (point.value === null) return;
    line += `${firstIndex === -1 ? "M" : "L"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`;
    if (firstIndex === -1) firstIndex = index;
    lastIndex = index;
    lastValue = point.value;
  });
  if (firstIndex === -1 || lastValue === null) return null;
  const area = `${line} L${x(lastIndex).toFixed(1)},${height} L${x(firstIndex).toFixed(1)},${height} Z`;
  const goalY = y(goal);
  const goalTextY = goalY < 12 ? goalY + 10 : goalY - 4;
  const firstDate = points[firstIndex]?.date ?? "";
  const lastDate = points[lastIndex]?.date ?? "";

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Цена обращения с ${formatLocalDate(firstDate)} по ${formatLocalDate(lastDate)}, ${goalLabel} ${formatRub(goal)}`}
      data-testid="cost-chart"
    >
      <defs>
        <linearGradient id="spark-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5646f2" stopOpacity="0.12" />
          <stop offset="1" stopColor="#5646f2" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1={goalY} x2={width} y2={goalY} stroke="#c9c7d6" strokeDasharray="4 5" strokeWidth="1" />
      <path d={area} fill="url(#spark-area)" />
      <path d={line} fill="none" stroke="#5646f2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(lastIndex)} cy={y(lastValue)} r="2.8" fill="#5646f2" />
      <text x="0" y={height} fontSize="9" fill="#9a98a8">
        {formatLocalDate(firstDate)}
      </text>
      <text x={width} y={height} textAnchor="end" fontSize="9" fill="#9a98a8">
        {formatLocalDate(lastDate)}
      </text>
      <text x={width} y={goalTextY} textAnchor="end" fontSize="9" fill="#9a98a8">
        {goalLabel} {formatRub(goal)}
      </text>
    </svg>
  );
}
