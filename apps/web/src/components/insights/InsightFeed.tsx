"use client";

import { CheckOutlined, ExperimentOutlined, EyeOutlined, RobotOutlined, RollbackOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Button, Progress } from "antd";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { experimentProgress, experimentReady } from "@/lib/experiments-model";
import type { ExperimentVariant } from "@/lib/experiments-model";
import { formatDateTime, formatLocalDate, formatRub, sentence } from "@/lib/format";
import type { HistoryItem } from "@/lib/history-view";
import { DECISION_LABELS, INSIGHT_AUTHORS, QUIET_DAY } from "@/lib/insights-model";
import type { DayReviewModel, HypothesisCardModel, InsightCardModel, InsightFeedModel, WeeklyReviewModel } from "@/lib/insights-model";
import { RollbackDialog } from "../history/RollbackDialog";
import { DiffText } from "../ui/DiffText";
import { Chip } from "../ui/primitives";

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="insight-part">
      <span className="t-eyebrow">{title}</span>
      {children}
    </div>
  );
}

/**
 * One insight (insights spec «Инсайт»): what was noticed, on which facts, what was decided with the guard's answer and
 * what comes next; «Вернуть как было» while the decision can be rolled back, «На самом деле» in a simulation.
 */
export function InsightCard({ card, timeZone, onRollback }: { card: InsightCardModel; timeZone: string; onRollback?: (item: HistoryItem) => void }) {
  const status = card.decision.status === "none" ? null : DECISION_LABELS[card.decision.status];
  /** Evidence and forecast are one click away: a feed of many insights stays readable on a phone. */
  const [details, setDetails] = useState(false);
  const hasDetails = card.facts.length > 0 || Boolean(card.next);
  return (
    <article className="surface insight-card" id={`insight-${card.id}`} data-testid="insight">
      <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
        <span className={`icon-tile ${card.author === "agent" ? "accent" : ""}`} aria-hidden="true">
          {card.author === "agent" ? <RobotOutlined /> : <SafetyCertificateOutlined />}
        </span>
        <Chip tone="accent" plain>
          {INSIGHT_AUTHORS[card.author]}
        </Chip>
        <span className="spacer" />
        <span className="t-small">{formatDateTime(card.at, timeZone)}</span>
      </div>
      <Part title="Что заметили">
        <p className="t-body insight-observation">{card.observation}</p>
      </Part>
      <Part title="Что решили">
        <div className="row" style={{ "--gap": "8px", alignItems: "center" } as React.CSSProperties}>
          <span className="t-body" style={{ flex: "1 1 220px" }}>
            {card.decision.text}
          </span>
          {status ? <Chip tone={status.tone}>{status.text}</Chip> : null}
        </div>
        {card.rollback && onRollback ? (
          <Button size="small" icon={<RollbackOutlined aria-hidden="true" />} onClick={() => card.rollback && onRollback(card.rollback)} style={{ alignSelf: "flex-start", marginTop: 4 }}>
            Вернуть как было
          </Button>
        ) : null}
      </Part>
      {hasDetails ? (
        <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
          <button type="button" className="link-button" style={{ alignSelf: "flex-start" }} aria-expanded={details} onClick={() => setDetails(!details)}>
            {details ? "Скрыть данные и прогноз" : "На каких данных и что дальше"}
          </button>
          {details ? (
            <>
              {card.facts.length > 0 ? (
                <Part title="На каких данных">
                  <dl className="insight-facts">
                    {card.facts.map((fact) => (
                      <div key={fact.label}>
                        <dt>{fact.label}</dt>
                        <dd className="t-num">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                </Part>
              ) : null}
              {card.next ? (
                <Part title="Что дальше">
                  <p className="t-body">{card.next}</p>
                </Part>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {card.truth ? (
        <div className={`note insight-truth note-${card.truth.tone}`} data-testid="insight-truth">
          <span className="note-icon">
            <EyeOutlined aria-hidden="true" />
          </span>
          <span>{card.truth.text}</span>
        </div>
      ) : null}
    </article>
  );
}

function Variant({ label, v, other, accent }: { label: string; v: ExperimentVariant; other: ExperimentVariant | null; accent?: boolean }) {
  return (
    <div className="surface" style={{ padding: 14, boxShadow: "none", background: accent ? "var(--accent-soft)" : "var(--surface-2)", borderColor: accent ? "transparent" : undefined }}>
      <div className="stack" style={{ "--gap": "6px" } as React.CSSProperties}>
        <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
          <span className="t-eyebrow">{label}</span>
          {v.active ? null : <Chip>отключено — не приводило клиентов</Chip>}
        </div>
        <span style={{ fontWeight: 600 }}>{other ? <DiffText text={v.title} other={other.title} /> : v.title}</span>
        {v.text ? <span className="t-body">{other ? <DiffText text={v.text} other={other.text} /> : v.text}</span> : null}
        <span className="t-small t-num">
          переходов на сайт {v.clicks} · обращений {v.leads} · потрачено {formatRub(v.spend)}
        </span>
      </div>
    </div>
  );
}

/** «Сейчас проверяем»: the one running A/B check, first in the feed, with both texts, its day and progress (ab-testing spec). */
function CheckInsight({ check }: { check: NonNullable<InsightFeedModel["check"]> }) {
  const { item, minDays, maxDays, minClicks } = check;
  return (
    <article className="surface insight-card" data-testid="experiment">
      <div className="row" style={{ "--gap": "10px", flexWrap: "nowrap", alignItems: "flex-start" } as React.CSSProperties}>
        <span className="icon-tile accent">
          <ExperimentOutlined />
        </span>
        <div className="stack" style={{ "--gap": "4px", flex: 1 } as React.CSSProperties}>
          <span className="t-eyebrow">Сейчас проверяем</span>
          <h3 className="t-h3">{item.hypothesis}</h3>
          <span className="t-small">
            с {formatLocalDate(item.startedOn)} · идёт {item.day}-й день из {maxDays} максимум
          </span>
        </div>
        <Chip tone="accent">Идёт</Chip>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <Variant label="Сейчас" v={item.control} other={item.variant} />
        {item.variant ? <Variant label="Новый вариант" v={item.variant} other={item.control} accent /> : null}
      </div>
      <Progress percent={experimentProgress(item, { minDays, maxDays, minClicks })} size="small" showInfo={false} />
      <Part title="Что дальше">
        <p className="t-body">
          {experimentReady(item, { minDays, minClicks })
            ? `Данных уже достаточно. Ждём, когда разница станет надёжной, — самое позднее на ${maxDays}-й день.`
            : `Вывод сделаем не раньше чем через ${minDays} дней и когда у каждого варианта наберётся хотя бы ${minClicks} переходов. Если за ${maxDays} день разница не проявится, оставим вариант, где обращение обходится дешевле.`}
        </p>
      </Part>
      {item.variant ? <span className="t-small">Выделено то, чем варианты отличаются.</span> : null}
    </article>
  );
}

function Hypothesis({ h }: { h: HypothesisCardModel }) {
  return (
    <li className="stack" style={{ "--gap": "2px" } as React.CSSProperties} data-testid="hypothesis">
      <strong style={{ color: "var(--text)" }}>{h.statement}</strong>
      {h.outcome === null ? (
        <span className="t-small">
          {h.check} — к {formatLocalDate(h.checkOn)}
        </span>
      ) : (
        <span className="t-small">
          {sentence(h.outcome)}
          {h.result ? `: ${h.result}` : ""}
        </span>
      )}
    </li>
  );
}

/** «Разбор недели» (insights spec): the agent's message, «Проверяем», «Выяснили» and the turn's insights. */
function WeeklyReview({ weekly, timeZone, onRollback }: { weekly: WeeklyReviewModel; timeZone: string; onRollback: (item: HistoryItem) => void }) {
  return (
    <div className="stack surface weekly-review" style={{ "--gap": "10px" } as React.CSSProperties} data-testid="weekly-review">
      <h4 className="weekly-title">Разбор недели</h4>
      {weekly.summary ? (
        <p className="t-body" data-testid="weekly-summary">
          {weekly.summary}
        </p>
      ) : null}
      {weekly.found.length > 0 ? (
        <Part title="Выяснили">
          <ul className="stack" style={{ "--gap": "8px" } as React.CSSProperties} data-testid="weekly-found">
            {weekly.found.map((h) => (
              <Hypothesis key={h.id} h={h} />
            ))}
          </ul>
        </Part>
      ) : null}
      {weekly.checking.length > 0 ? (
        <Part title="Проверяем">
          <ul className="stack" style={{ "--gap": "8px" } as React.CSSProperties} data-testid="weekly-checking">
            {weekly.checking.map((h) => (
              <Hypothesis key={h.id} h={h} />
            ))}
          </ul>
        </Part>
      ) : null}
      {weekly.insights.map((card) => (
        <InsightCard key={card.id} card={card} timeZone={timeZone} onRollback={onRollback} />
      ))}
    </div>
  );
}

function DayReview({ day, timeZone, onRollback }: { day: DayReviewModel; timeZone: string; onRollback: (item: HistoryItem) => void }) {
  /**
   * A turn that only observed: the message, «Что заметили» and «Что решили» all say «nothing changes», so the day reads
   * as one line and its insights stay one click away.
   */
  const observationsOnly = !day.quiet && day.rulesReason === null && day.weekly === null && day.insights.length > 0 && day.insights.every((card) => card.decision.status === "none");
  const [open, setOpen] = useState(false);
  return (
    <section className="stack day-review" style={{ "--gap": "10px" } as React.CSSProperties} data-testid="day-review">
      <h3 className="t-h3">{day.from ? `С ${formatLocalDate(day.from)} по ${formatLocalDate(day.date)}` : `Разбор ${formatLocalDate(day.date)}`}</h3>
      {day.weekly ? <WeeklyReview weekly={day.weekly} timeZone={timeZone} onRollback={onRollback} /> : null}
      {day.rulesReason ? (
        <div className="note" data-testid="rules-day">
          <span className="note-icon">
            <SafetyCertificateOutlined aria-hidden="true" />
          </span>
          <span>{day.rulesReason}</span>
        </div>
      ) : null}
      {observationsOnly ? (
        <div className="note" data-testid="observation-day">
          <span className="note-icon">
            <CheckOutlined aria-hidden="true" />
          </span>
          <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
            <strong style={{ color: "var(--text)" }}>{QUIET_DAY}</strong>
            {day.summary ? <span>{day.summary}</span> : null}
            <button type="button" className="link-button" style={{ alignSelf: "flex-start" }} aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Скрыть, что заметили" : `Что заметили (${day.insights.length})`}
            </button>
          </div>
        </div>
      ) : day.quiet ? (
        <div className="note" data-testid="quiet-day">
          <span className="note-icon">
            <CheckOutlined aria-hidden="true" />
          </span>
          <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
            <strong style={{ color: "var(--text)" }}>{QUIET_DAY}</strong>
            {day.summary ? <span>{day.summary}</span> : null}
          </div>
        </div>
      ) : day.summary ? (
        <p className="t-body day-summary" data-testid="day-summary">
          {day.summary}
        </p>
      ) : null}
      {observationsOnly && !open
        ? null
        : day.insights.map((card) => <InsightCard key={card.id} card={card} timeZone={timeZone} onRollback={onRollback} />)}
    </section>
  );
}

/**
 * The insight feed (insights spec «Лента инсайтов»): the running check first, then the day reviews, newest first.
 * `empty` says when the first review comes.
 */
export function InsightFeed({ feed, empty }: { feed: InsightFeedModel; empty: ReactNode }) {
  const router = useRouter();
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  return (
    <div className="stack" style={{ "--gap": "22px" } as React.CSSProperties} data-testid="insight-feed">
      {feed.check ? <CheckInsight check={feed.check} /> : null}
      {feed.days.length === 0 ? empty : feed.days.map((day) => <DayReview key={day.date} day={day} timeZone={feed.timeZone} onRollback={setSelected} />)}
      {selected ? (
        <RollbackDialog
          item={selected}
          items={[selected]}
          names={feed.names}
          onClose={(changed) => {
            setSelected(null);
            if (changed) router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
