"use client";

import { CheckOutlined, EyeOutlined, FastForwardOutlined, RollbackOutlined } from "@ant-design/icons";
import { Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatCount, formatLocalDate, formatRub, plural } from "@/lib/format";
import type { HistoryItem, Names } from "@/lib/history-view";
import { DECISION_LABELS } from "@/lib/insights-model";
import type { InsightCardModel } from "@/lib/insights-model";
import { channelLabel } from "@/lib/summary-model";
import { VERDICT_WORDS } from "@/lib/week-story";
import type { WeekStoryModel } from "@/lib/week-story";
import { RollbackDialog } from "../history/RollbackDialog";
import { Chip } from "../ui/primitives";
import type { Tone } from "../ui/primitives";

const VERDICT_TONES: Record<keyof typeof VERDICT_WORDS, Tone> = { learning: "neutral", effective: "success", borderline: "warning", ineffective: "danger" };

/** Real milliseconds per beat of the story: a day lights up, an insight appears. */
const DAY_MS = 320;
const INSIGHT_MS = 1_100;
/** At most this many insights appear one by one; the rest of a busy week comes at once. */
const ANIMATED_INSIGHTS = 5;

/** Whether the owner asked the system for less motion: then the story is shown at once. */
const prefersReducedMotion = (): boolean => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** «8–14 декабря» or «29 ноября – 5 декабря». */
const rangeText = (from: string, to: string): string =>
  from.slice(0, 7) === to.slice(0, 7) ? `${Number(from.slice(8, 10))}–${formatLocalDate(to)}` : `${formatLocalDate(from)} – ${formatLocalDate(to)}`;

/**
 * The story of a lived week (simulation-mode spec «История недели»): the days light up and the week's money and leads
 * grow to their totals, the service's insights appear one by one and light the rows of their facts, then its decisions
 * with the guard's answers and the comparison. Everything is read from what is saved; «Показать сразу» and the
 * system's «less motion» show every scene at once.
 */
export function WeekStory({ story, names }: { story: WeekStoryModel; names: Names }) {
  const router = useRouter();
  const insights = useMemo<InsightCardModel[]>(() => [...story.reviews].reverse().flatMap((r) => [...r.insights].reverse()), [story.reviews]);
  const quietDays = useMemo(
    () =>
      story.reviews
        .filter((r) => r.quiet && r.insights.length === 0)
        .reduce((sum, r) => sum + (r.from === null ? 1 : Math.round((Date.parse(`${r.date}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) + 1), 0),
    [story.reviews],
  );
  // The beat of the story: the days lit, then the insights shown, then the decisions.
  const total = story.days.length + Math.min(insights.length, ANIMATED_INSIGHTS) + 1;
  const [beat, setBeat] = useState(() => (prefersReducedMotion() ? total : 0));
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  useEffect(() => {
    setBeat(prefersReducedMotion() ? total : 0);
  }, [story.week, total]);
  useEffect(() => {
    if (beat >= total) return;
    const timer = setTimeout(() => setBeat((b) => b + 1), beat < story.days.length ? DAY_MS : INSIGHT_MS);
    return () => clearTimeout(timer);
  }, [beat, total, story.days.length]);

  const done = beat >= total;
  const daysLit = Math.min(beat, story.days.length);
  const shownInsights = done ? insights.length : Math.max(0, Math.min(beat - story.days.length, ANIMATED_INSIGHTS));
  const reviewing = !done && beat >= story.days.length;
  const lit = new Set(reviewing && shownInsights > 0 ? (insights[shownInsights - 1]?.objectIds ?? []) : []);
  const spendSoFar = story.days.slice(0, daysLit).reduce((s, d) => s + d.spend, 0);
  const leadsSoFar = story.days.slice(0, daysLit).reduce((s, d) => s + d.leads, 0);
  const maxSpend = Math.max(1, ...story.rows.map((r) => r.spend));

  return (
    <section className="surface week-story" data-testid="week-story" aria-label={`История недели ${story.week}`}>
      <header className="week-head">
        <div className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
          <span className="t-eyebrow">Неделя {story.week}</span>
          <h2 className="t-h2">{rangeText(story.from, story.to)}</h2>
        </div>
        <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
          {story.weeks.length > 1 ? (
            <nav className="week-tabs" aria-label="Прожитые недели">
              {story.weeks.map((w) => (
                <Link key={w.week} href={`/simulation?week=${w.week}`} aria-current={w.week === story.week ? "page" : undefined}>
                  {w.week}
                </Link>
              ))}
            </nav>
          ) : null}
          {done ? null : (
            <Button size="small" icon={<FastForwardOutlined aria-hidden="true" />} onClick={() => setBeat(total)}>
              Показать сразу
            </Button>
          )}
        </div>
      </header>

      {/* 1. «Неделя прошла» */}
      <div className="week-scene" data-testid="week-scene-days">
        <h3 className="t-h3">Неделя прошла</h3>
        <ol className="week-days" aria-label="Дни недели">
          {story.days.map((d, i) => (
            <li key={d.date} data-lit={i < daysLit} title={formatLocalDate(d.date)}>
              <span>{Number(d.date.slice(8, 10))}</span>
            </li>
          ))}
        </ol>
        <div className="week-counters">
          <div>
            <span className="t-small">Потрачено</span>
            <span className="t-num week-big" data-testid="week-spend">
              {formatRub(spendSoFar)}
            </span>
          </div>
          <div>
            <span className="t-small">Обращения</span>
            <span className="t-num week-big" data-testid="week-leads">
              {formatCount(leadsSoFar)}
            </span>
          </div>
          <div>
            <span className="t-small">Цена обращения</span>
            <span className="t-num week-big">{daysLit === story.days.length && story.totals.costPerLead !== null ? formatRub(story.totals.costPerLead) : "—"}</span>
          </div>
        </div>
        <ul className="week-rows" data-testid="week-rows">
          {story.rows.map((row) => (
            <li key={row.adId} data-lit={lit.has(row.adId) || lit.has(row.directionId)} data-shown={daysLit > 0}>
              <div className="week-row-head">
                <span className="week-row-title">{row.title}</span>
                <span className="t-small">{channelLabel(row.channel)}</span>
                <span className="spacer" />
                <Chip tone={VERDICT_TONES[row.verdict]}>{VERDICT_WORDS[row.verdict]}</Chip>
              </div>
              <span className="week-bar" aria-hidden="true">
                <i style={{ width: `${daysLit === story.days.length ? Math.max(2, (row.spend / maxSpend) * 100) : 0}%` }} />
              </span>
              <span className="t-small t-num">
                {formatRub(row.spend)} · переходов {formatCount(row.clicks)} · обращений {formatCount(row.leads)}
                {row.costPerLead === null ? "" : ` по ${formatRub(row.costPerLead)}`}
              </span>
              {row.truth ? (
                <span className={`week-truth note-${row.truth.tone}`}>
                  <EyeOutlined aria-hidden="true" /> {row.truth.text}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {/* 2. «Сервис разбирает неделю» */}
      {beat >= story.days.length ? (
        <div className="week-scene fade-in" data-testid="week-scene-review">
          <h3 className="t-h3">Сервис разбирает неделю</h3>
          {quietDays > 0 ? (
            <p className="t-small" data-testid="week-quiet">
              <CheckOutlined aria-hidden="true" /> {quietDays} {plural(quietDays, "день", "дня", "дней")} — менять ничего не нужно
            </p>
          ) : null}
          <ol className="week-insights">
            {insights.slice(0, shownInsights).map((card) => (
              <li key={card.id} className="fade-in" data-testid="week-insight">
                <strong className="t-body">{card.observation}</strong>
                {card.decision.text ? <span className="t-small">{card.decision.text}</span> : null}
              </li>
            ))}
          </ol>
          {insights.length === 0 && quietDays === 0 ? <p className="t-small">Разборов за неделю не было.</p> : null}
        </div>
      ) : null}

      {/* 3. «Решение» */}
      {done ? (
        <div className="week-scene fade-in" data-testid="week-scene-decision">
          <h3 className="t-h3">Решение</h3>
          {story.decisions.length === 0 ? (
            <p className="t-body" data-testid="week-no-decision">
              За неделю менять ничего не понадобилось. <span className="t-muted">{story.noDecisionReason}</span>
            </p>
          ) : (
            <ul className="week-decisions">
              {story.decisions.map(({ item, insight }) => {
                const label = insight && insight.decision.status !== "none" ? DECISION_LABELS[insight.decision.status] : null;
                return (
                  <li key={item.id} data-testid="week-decision">
                    <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                      <strong>{item.object}</strong>
                      {label ? <Chip tone={label.tone}>{label.text}</Chip> : null}
                      {item.reverted ? <Chip plain>Отменено</Chip> : null}
                    </div>
                    <span className="t-body">{item.explanation}</span>
                    {item.diff.map((row) => (
                      <span key={row.label} className="t-small">
                        {row.label}: было {row.before} → стало {row.after}
                      </span>
                    ))}
                    <div className="row" style={{ "--gap": "12px" } as React.CSSProperties}>
                      {item.rollback.kind === "available" ? (
                        <Button size="small" icon={<RollbackOutlined aria-hidden="true" />} onClick={() => setSelected(item)}>
                          Вернуть как было
                        </Button>
                      ) : null}
                      <Link href={`/history#${item.id}`} className="t-small">
                        В истории
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {story.comparison ? (
            <p className="t-body week-compare" data-testid="week-compare">
              За неделю с сервисом — {formatCount(story.comparison.serviceWeek)} {plural(story.comparison.serviceWeek, "обращение", "обращения", "обращений")}, без него было бы{" "}
              {formatCount(story.comparison.baselineWeek)}. С начала: {formatCount(story.comparison.serviceTotal)} против {formatCount(story.comparison.baselineTotal)}.
            </p>
          ) : null}
        </div>
      ) : null}

      {selected ? (
        <RollbackDialog
          item={selected}
          items={[selected]}
          names={names}
          onClose={(changed) => {
            setSelected(null);
            if (changed) router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
