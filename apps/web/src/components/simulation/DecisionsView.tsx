"use client";

import { CheckCircleFilled, RobotOutlined } from "@ant-design/icons";
import Link from "next/link";
import { formatRub, plural } from "@/lib/format";
import type { Comparison, DecisionScreen, DecisionScreenModel, RunResult, RunTotals } from "@/lib/simulation-screen";
import { InsightFeed } from "../insights/InsightFeed";
import { Chip, Empty, PageHead, Surface, SurfaceHead } from "../ui/primitives";

const leadsWord = (n: number): string => plural(n, "обращение", "обращения", "обращений");

const perLead = (r: RunTotals): string => (r.costPerLead === null ? "обращений пока нет" : `${formatRub(r.costPerLead)} за обращение`);

/** «На 7 обращений больше (+22%)», said plainly either way (simulation-mode spec «Контрольный прогон»). */
const differenceText = (service: number, baseline: number): { text: string; tone: "success" | "danger" | "neutral" } => {
  const diff = service - baseline;
  if (diff === 0) return { text: "Пока поровну", tone: "neutral" };
  const percent = baseline === 0 ? null : Math.round((Math.abs(diff) / baseline) * 100);
  const share = percent === null ? "" : ` (${diff > 0 ? "+" : "−"}${percent}%)`;
  return diff > 0
    ? { text: `На ${diff} ${leadsWord(diff)} больше${share}`, tone: "success" }
    : { text: `На ${-diff} ${leadsWord(-diff)} меньше${share}`, tone: "danger" };
};

/** Leads by day of both runs; the service's decisions as ticks under the lines. */
function ComparisonChart({ comparison, totalDays, decisions }: { comparison: Comparison; totalDays: number; decisions: number[] }) {
  const width = 600;
  const height = 150;
  const top = Math.max(4, comparison.service.at(-1) ?? 0, comparison.baseline.at(-1) ?? 0) * 1.15;
  const x = (dayIndex: number) => ((dayIndex + 1) / totalDays) * (width - 8) + 4;
  const y = (v: number) => height - 22 - ((height - 34) * v) / top;
  const path = (values: number[]) => `M4,${y(0)} ${values.map((v, i) => `L${x(i)},${y(v)}`).join(" ")}`;
  const now = comparison.service.length - 1;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sim-ribbon" role="img" aria-label="Обращения нарастающим итогом с сервисом и без него">
      <line x1={4} x2={width - 4} y1={y(0)} y2={y(0)} stroke="var(--border)" />
      {decisions.map((d) => (
        <line key={d} x1={x(d - 1)} x2={x(d - 1)} y1={y(0) + 4} y2={y(0) + 12} stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" />
      ))}
      <path d={path(comparison.baseline)} fill="none" stroke="var(--text-3)" strokeWidth={2.5} strokeDasharray="6 5" strokeLinejoin="round" />
      <path d={path(comparison.service)} fill="none" stroke="var(--accent)" strokeWidth={3} strokeLinejoin="round" />
      {now >= 0 ? <circle cx={x(now)} cy={y(comparison.service[now] ?? 0)} r={4.5} fill="var(--accent)" /> : null}
      <text x={4} y={height - 2} fontSize={11} fill="var(--text-3)">
        день 1
      </text>
      <text x={width - 4} y={height - 2} fontSize={11} fill="var(--text-3)" textAnchor="end">
        день {totalDays}
      </text>
    </svg>
  );
}

function RunNumbers({ label, run, accent }: { label: string; run: RunTotals; accent?: boolean }) {
  return (
    <div className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
      <span className="t-small" style={{ fontWeight: 600, color: accent ? "var(--accent-ink)" : "var(--text-3)" }}>
        {label}
      </span>
      <span className="t-num" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.15, color: accent ? "var(--text)" : "var(--text-2)" }}>
        {run.leads} <span style={{ fontSize: 16, fontWeight: 600 }}>{leadsWord(run.leads)}</span>
      </span>
      <span className="t-small t-num">
        {perLead(run)} · потрачено {formatRub(run.spend)}
      </span>
    </div>
  );
}

/** The top of the screen: what the decisions gave so far, against the same scenario without them. */
function ComparisonCard({ comparison, day, totalDays, decisions, result }: { comparison: Comparison; day: number; totalDays: number; decisions: number[]; result: RunResult | null }) {
  // Before the first decision both runs differ only by random spread: a red «−100%» on day 1 would blame the service for noise.
  const diff =
    decisions.length === 0 && result === null
      ? { text: "Решений ещё не было", tone: "neutral" as const }
      : differenceText(comparison.serviceNow.leads, comparison.baselineNow.leads);
  return (
    <Surface className="surface-pad" data-testid="sim-comparison">
      <div className="stack" style={{ "--gap": "14px" } as React.CSSProperties}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
            <span className="t-eyebrow">{result ? `Итог за ${result.days} ${plural(result.days, "день", "дня", "дней")}` : `За ${day} ${plural(day, "день", "дня", "дней")} из ${totalDays}`}</span>
            <h2 className="t-h2">С сервисом и без него</h2>
          </div>
          <Chip tone={diff.tone === "neutral" ? "neutral" : diff.tone}>{diff.text}</Chip>
        </div>
        <div className="grid-2" style={{ gap: 12 }}>
          <RunNumbers label="С сервисом" run={comparison.serviceNow} accent />
          <RunNumbers label="Если бы сервис ничего не делал" run={comparison.baselineNow} />
        </div>
        <ComparisonChart comparison={comparison} totalDays={totalDays} decisions={decisions} />
        <div className="row t-small" style={{ "--gap": "16px" } as React.CSSProperties}>
          <span className="legend-item">
            <i style={{ background: "var(--accent)" }} /> с сервисом
          </span>
          <span className="legend-item">
            <i style={{ background: "var(--text-3)" }} /> без сервиса
          </span>
          <span className="legend-item">
            <i style={{ background: "var(--accent)", height: 8, width: 3 }} /> решение сервиса
          </span>
        </div>
        {result ? (
          <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties} data-testid="sim-result">
            <span className="t-body">
              С сервисом — {result.service.leads} {leadsWord(result.service.leads)}
              {result.service.costPerLead === null ? "" : ` по ${formatRub(result.service.costPerLead)}`}, потрачено {formatRub(result.service.spend)}.
            </span>
            <span className="t-body t-muted">
              Если бы сервис ничего не делал — {result.baseline.leads} {leadsWord(result.baseline.leads)}
              {result.baseline.costPerLead === null ? "" : ` по ${formatRub(result.baseline.costPerLead)}`}, потрачено {formatRub(result.baseline.spend)}.
            </span>
          </div>
        ) : null}
        <span className="t-small">
          {day < 7 ? "Первые решения сервис принимает примерно на 7-й день — после них линии расходятся. " : ""}
          Оба прогона идут по одному сценарию и тратят бюджет по одному правилу, поэтому разница — от решений сервиса. Случайный разброс у прогонов свой: сравнивайте итог, а не отдельные дни.
          {result && result.service.leads <= result.baseline.leads ? " В этот раз сервис не дал больше обращений — так бывает, когда реклама и без изменений работает ровно." : ""}
        </span>
      </div>
    </Surface>
  );
}

function Checklist({ items }: { items: DecisionScreenModel["checklist"] }) {
  const done = items.filter((i) => i.done).length;
  return (
    <Surface>
      <SurfaceHead title="Что сервис уже показал" extra={<Chip tone={done === items.length ? "success" : "accent"}>{`${done} из ${items.length}`}</Chip>} />
      <ul className="checklist" style={{ padding: "4px 20px 8px" }} data-testid="sim-checklist">
        {items.map((item) => (
          <li key={item.key} data-done={item.done}>
            <span className="check-icon" style={item.done ? undefined : { background: "var(--surface-3)", color: "var(--text-3)" }}>
              {item.done ? <CheckCircleFilled /> : "○"}
            </span>
            <div className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
              <span className="t-body" style={{ fontWeight: item.done ? 600 : 400 }}>
                {item.title}
              </span>
              {item.hint ? <span className="t-small">{item.hint}</span> : null}
            </div>
            {item.entryId ? (
              <Link href={`/history#${item.entryId}`} className="t-small">
                в истории
              </Link>
            ) : item.key === "rollback" && !item.done ? (
              <Link href="/history" className="t-small">
                открыть историю
              </Link>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
    </Surface>
  );
}

export function DecisionsView({ model }: { model: DecisionScreen }) {
  return (
    <div className="page">
      <PageHead
        title="Как сервис принимает решения"
        lead={`${model.scenarioTitle ? `Сценарий «${model.scenarioTitle}». ` : ""}Здесь видно то, чего сервис не знает: как объявления работают на самом деле — и верно ли он это понял.`}
      />
      <div className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
        {model.comparison ? <ComparisonCard comparison={model.comparison} day={model.day} totalDays={model.totalDays} decisions={model.decisionDays} result={model.result} /> : null}
        <Checklist items={model.checklist} />
        <section className="stack" style={{ "--gap": "14px" } as React.CSSProperties} data-testid="sim-feed">
          <h2 className="t-h2">Что сервис заметил и решил</h2>
          <InsightFeed
            feed={model.feed}
            empty={
              <Surface>
                <Empty icon={<RobotOutlined aria-hidden="true" />} title="Разборов пока не было">
                  Сервис разбирает рекламу каждое утро: первый разбор — утром 2-го виртуального дня, первые решения — примерно на 7-й день.
                </Empty>
              </Surface>
            }
          />
        </section>
      </div>
    </div>
  );
}
