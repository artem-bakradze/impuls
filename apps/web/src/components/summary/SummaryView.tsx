"use client";

import { addDays } from "@impuls/core";
import { Alert } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PENDING_TEXT, runWebJobs } from "@/lib/client-api";
import type { CommandResult } from "@/lib/client-api";
import { formatCount, formatLocalDate, formatRub, plural } from "@/lib/format";
import type { HistoryItem } from "@/lib/history-view";
import type { AdsWork } from "@/lib/server/simulation-screen";
import type { LastChange } from "@/lib/service-work";
import { adsState, adsStateText, goalBadge, goalComparable } from "@/lib/summary-model";
import type { SummaryModel } from "@/lib/summary-model";
import { RollbackDialog } from "../history/RollbackDialog";
import { AdsSheet } from "./AdsSheet";
import { Sparkline, trendOf } from "./Sparkline";
import { HistorySheet } from "./HistorySheet";
import { QuestionSheet } from "./QuestionSheet";

type Sheet = "ads" | "history" | "question" | null;

type Exception = {
  tone: "warning" | "danger";
  text: string;
  title?: string;
  count?: number;
  action?: { label: string; onClick: () => void } | { label: string; href: string };
};

const relativeDay = (date: string, today: string): string => (date === today ? "сегодня" : date === addDays(today, -1) ? "вчера" : formatLocalDate(date));

const undoable = (change: LastChange): change is LastChange & { item: HistoryItem } => change.item !== null && !change.item.reverted && change.item.rollback.kind === "available";

/** A service change as a label, its day and why in one line, with «Вернуть» for a reversible one (change-history spec). */
function ChangeItem({ change, today, onRollback, testId }: { change: LastChange; today: string; onRollback: (item: HistoryItem) => void; testId: string }) {
  return (
    <div className="brief-change" data-testid={testId}>
      <span className="brief-when">{relativeDay(change.date, today)}</span>
      <div className="brief-change-line">
        <span className="brief-what">{change.text}</span>
        {undoable(change) ? (
          <button type="button" className="brief-action" onClick={() => onRollback(change.item)} aria-label={`Вернуть как было: ${change.text}`}>
            Вернуть
          </button>
        ) : null}
      </div>
      {change.reason ? <p className="brief-reason">{change.reason}</p> : null}
    </div>
  );
}

/**
 * «Реклама» as one answer (analytics spec): the price of a lead, the budget, the last change and two ways deeper.
 * Ads and history live in sheets; explanations never compete with the answer for the first screen.
 */
export function SummaryView({ model, work, focusWeek = null }: { model: SummaryModel; work: AdsWork; focusWeek?: number | null }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(() => (focusWeek !== null ? "history" : null));
  const [rollback, setRollback] = useState<HistoryItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (focusWeek !== null) setSheet("history");
    else if (window.location.hash.startsWith("#log-")) setSheet("history");
  }, [focusWeek]);

  const resume = async () => {
    setBusy("resume");
    setError(null);
    const outcome = await runWebJobs<CommandResult>("/api/commands", { action: "resumeAll" });
    setBusy(null);
    if (outcome.kind === "pending") {
      setError(PENDING_TEXT);
    } else if (outcome.kind === "error") {
      setError(outcome.message);
    } else {
      const failed = outcome.output.find((r) => r.status === "rejected" || r.status === "failed");
      if (failed) setError(`Не получилось: ${failed.message}`);
      else router.refresh();
    }
  };

  const firstDay = model.state === "first_day";
  const today = model.dataPeriod?.to ?? "";
  const q = model.attention.clientsQuestion;
  const notification = model.attention.notifications[0] ?? null;
  const measurement = model.measurement;
  const comparable = goalComparable(model.goal);
  const goalText = `${comparable ? "цель" : "ориентир"} ${formatRub(model.goal.cso)}`;
  const over = comparable && model.goal.status === "above";
  const number = model.goal.current === null ? "—" : formatRub(model.goal.current);
  const share = model.monthBudget > 0 ? Math.min(100, (model.spentMonth / model.monthBudget) * 100) : 0;
  const budgetTone = model.spentMonth >= model.monthBudget ? "danger" : model.budgetForecast !== null ? "warning" : undefined;

  let exception: Exception | null = null;
  if (model.state === "paused") {
    exception = { tone: "warning", text: "Реклама на паузе", action: { label: "Возобновить", onClick: () => void resume() } };
  } else if (q !== null) {
    exception = { tone: "warning", text: "1 вопрос", action: { label: "Ответить", onClick: () => setSheet("question") } };
  } else if (notification !== null) {
    exception = { tone: "warning", text: notification.message, title: notification.message, count: model.attention.notifications.length };
  } else if (measurement && !model.simulation && measurement.status !== "found") {
    exception = {
      tone: "warning",
      text: measurement.status === "not_found" ? "Счётчик не найден" : "Учёт не проверен",
      action: { label: "Настроить", href: "/settings#site" },
    };
  }

  const last = work.lastChange;
  const trend = trendOf((model.daily ?? []).slice(-14));
  const state = adsState({ state: model.state, simulation: model.simulation !== null, moderationPending: model.moderation.pending, shown: work.shown.length });
  const badge = firstDay ? null : goalBadge(model.goal);
  const planShare = model.monthBudget > 0 ? Math.min(100, (model.budgetPlan / model.monthBudget) * 100) : 0;
  const caption = firstDay
    ? model.moderation.pending > 0 && !model.simulation
      ? "проверка Яндекса · первые данные завтра"
      : "первые данные завтра"
    : `за обращение · ${goalText}`;

  return (
    <div className="page brief-page">
      <h1 className="sr-only">Реклама</h1>
      <div className="brief-layout" data-side={work.recentChanges.length > 0 || undefined}>
      <div className="brief" data-testid={firstDay ? "first-day" : "brief"}>
        <div className="brief-date">
          <time dateTime={today}>{today === "" ? "" : formatLocalDate(today)}</time>
          {model.simulation ? <span className="brief-mode">симуляция</span> : null}
          <span className="brief-state" data-state={state.kind} data-testid="ads-state">
            <i aria-hidden="true" />
            {adsStateText(state)}
          </span>
        </div>

        <div className="brief-hero">
          <div className="brief-number" data-tone={over ? "danger" : undefined}>
            {firstDay ? "Запуск" : number}
          </div>
          <p className="brief-caption" data-testid="goal-line">
            <span>{caption}</span>
            {badge !== null ? (
              <span className="brief-badge" data-testid="goal-badge">
                {badge}
              </span>
            ) : null}
          </p>
        </div>
        <Sparkline points={trend} goal={model.goal.cso} goalLabel={comparable ? "цель" : "ориентир"} />

        <div className="brief-metrics">
          <div className="brief-metric">
            <span className="brief-value">{formatCount(model.leads.value)}</span>
            <span className="brief-label">{plural(model.leads.value, "обращение", "обращения", "обращений")}</span>
          </div>
          <div className="brief-metric brief-budget" data-testid="budget-tile">
            <span className="brief-value">{formatRub(model.spentMonth)}</span>
            <span className="brief-label">из {formatRub(model.monthBudget)}</span>
          </div>
        </div>
        <div className="brief-bar" data-tone={budgetTone} data-testid="budget-bar">
          <i style={{ width: `${share}%` }} aria-hidden="true" />
          {model.monthBudget > 0 && !firstDay ? (
            <>
              <b className="brief-plan" style={{ left: `${planShare}%` }} aria-hidden="true" />
              <span className="brief-plan-label" style={{ left: `${planShare}%` }} data-edge={planShare > 88 ? "end" : planShare < 12 ? "start" : undefined} data-testid="budget-plan">
                <span className="sr-only">по плану к {today === "" ? "сегодня" : formatLocalDate(today)}: {formatRub(model.budgetPlan)}, </span>
                план
              </span>
            </>
          ) : null}
        </div>

        {exception !== null ? (
          <div className="brief-exception" data-tone={exception.tone} data-testid="brief-exception">
            <span className="brief-exception-text" title={exception.title ?? exception.text}>
              {exception.text}
            </span>
            {exception.count !== undefined && exception.count > 1 ? <span className="brief-exception-count">+{exception.count - 1}</span> : null}
            {exception.action === undefined ? null : "href" in exception.action ? (
              <Link className="brief-action" href={exception.action.href}>
                {exception.action.label}
              </Link>
            ) : (
              <button type="button" className="brief-action" onClick={exception.action.onClick} disabled={busy === "resume"}>
                {exception.action.label}
              </button>
            )}
          </div>
        ) : last !== null ? (
          <ChangeItem change={last} today={today} onRollback={setRollback} testId="last-change" />
        ) : null}

        {error !== null ? <Alert className="brief-error" type="error" showIcon title={error} /> : null}

        <div className="brief-rows">
          <button type="button" className="brief-row" onClick={() => setSheet("ads")}>
            <span>Объявления</span>
            <span className="brief-row-end">
              {work.shown.length}
              <span className="brief-chev" aria-hidden="true">›</span>
            </span>
          </button>
          <button type="button" className="brief-row" onClick={() => setSheet("history")}>
            <span>История</span>
            <span className="brief-row-end" data-testid="history-count">
              {work.changesLast7 > 0 ? `${work.changesLast7} ${plural(work.changesLast7, "изменение", "изменения", "изменений")} за неделю` : null}
              <span className="brief-chev" aria-hidden="true">›</span>
            </span>
          </button>
        </div>
      </div>

      {work.recentChanges.length > 0 ? (
        <aside className="brief-side" aria-label="Что сделал сервис" data-testid="service-changes">
          <h2 className="brief-side-title">Что сделал сервис</h2>
          {work.recentChanges.map((change) => (
            <ChangeItem key={change.historyId ?? change.text} change={change} today={today} onRollback={setRollback} testId="service-change" />
          ))}
          <button type="button" className="brief-side-all" onClick={() => setSheet("history")}>
            Вся история <span aria-hidden="true">›</span>
          </button>
        </aside>
      ) : null}
      </div>

      {sheet === "ads" ? <AdsSheet work={work} onClose={() => setSheet(null)} /> : null}
      {sheet === "history" ? <HistorySheet work={work} clientCost={model.clientCost} focusWeek={focusWeek} onClose={() => setSheet(null)} onRollback={setRollback} /> : null}
      {sheet === "question" && q !== null ? <QuestionSheet question={q} onClose={() => setSheet(null)} onDone={() => router.refresh()} /> : null}
      {rollback !== null ? (
        <RollbackDialog
          item={rollback}
          items={work.history}
          names={work.names}
          onClose={(changed) => {
            setRollback(null);
            if (changed) router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
