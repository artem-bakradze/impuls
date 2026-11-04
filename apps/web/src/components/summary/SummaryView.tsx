"use client";

import { CalendarOutlined, HistoryOutlined, NotificationOutlined, RightOutlined } from "@ant-design/icons";
import { addDays } from "@impuls/core";
import { Alert, Popover } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PENDING_TEXT, runWebJobs } from "@/lib/client-api";
import type { CommandResult } from "@/lib/client-api";
import { dayWordsOf } from "@/lib/day-words";
import type { DayWords } from "@/lib/day-words";
import { formatCount, formatRub, plural } from "@/lib/format";
import type { HistoryItem } from "@/lib/history-view";
import type { AdsWork } from "@/lib/server/simulation-screen";
import type { LastChange } from "@/lib/service-work";
import { agentTurnText, elapsedText, stepText } from "@/lib/simulation-model";
import type { SimulationStatus } from "@/lib/simulation-model";
import { adsState, adsStateText, goalBadge, goalComparable, goalExplanation, nextStepText } from "@/lib/summary-model";
import type { SummaryModel } from "@/lib/summary-model";
import { RollbackDialog } from "../history/RollbackDialog";
import { isStepping, SimulationPlayer } from "../simulation/SimulationPlayer";
import { useSimulation } from "../simulation/useSimulation";
import { DayWordsContext } from "../ui/DayWordsContext";
import { BudgetPaceChip } from "../ui/ResultChip";
import { AdsSheet } from "./AdsSheet";
import { HistorySheet } from "./HistorySheet";
import { QuestionSheet } from "./QuestionSheet";
import { latestReview, ReviewRail } from "./ReviewRail";
import { Sparkline, trendOf } from "./Sparkline";

type Sheet = "ads" | "history" | "question" | null;

type Exception = {
  tone: "warning" | "danger";
  text: string;
  title?: string;
  count?: number;
  action?: { label: string; onClick: () => void } | { label: string; href: string };
};

const relativeDay = (date: string, today: string, words: DayWords): string => (date === today ? "сегодня" : date === addDays(today, -1) ? "вчера" : words.date(date));

const undoable = (change: LastChange): change is LastChange & { item: HistoryItem } => change.item !== null && !change.item.reverted && change.item.rollback.kind === "available";

/** A service change as a label, its day and why in one line, with «Вернуть» for a reversible one (change-history spec). */
function ChangeItem({ change, today, words, onRollback, testId }: { change: LastChange; today: string; words: DayWords; onRollback: (item: HistoryItem) => void; testId: string }) {
  return (
    <div className="brief-change" data-testid={testId}>
      <span className="brief-when">{relativeDay(change.date, today, words)}</span>
      <div className="brief-change-line">
        <span className="brief-what">{change.text}</span>
        {undoable(change) ? (
          <button type="button" className="brief-action" onClick={() => onRollback(change.item)} aria-label={`Вернуть как было: ${change.text}`}>
            Вернуть
          </button>
        ) : null}
      </div>
      {change.reason ? <p className="brief-reason">{words.text(change.reason)}</p> : null}
    </div>
  );
}

/**
 * «Реклама» as one answer (analytics spec), the one screen of both modes: the price of a lead, the budget, the next step
 * and two ways deeper, with the service's review beside it as the assistant's message. In a simulation the player stands
 * over the answer and days are numbers (simulation-mode spec «Симуляция как отдельный режим», «Дни симуляции вместо
 * дат»). Ads and history live in sheets.
 */
export function SummaryView({ model, work, focusWeek = null, simulation = null }: { model: SummaryModel; work: AdsWork; focusWeek?: number | null; simulation?: SimulationStatus | null }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(() => (focusWeek !== null ? "history" : null));
  const [rollback, setRollback] = useState<HistoryItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sim = useSimulation(simulation);
  const words = useMemo(() => dayWordsOf(work.sim), [work.sim]);
  const review = latestReview(work);
  // The review the page opened with is shown at once; one that arrives after a step is written part by part.
  const openedReview = useRef(review?.id ?? null);

  useEffect(() => {
    if (focusWeek !== null) setSheet("history");
    else if (window.location.hash === "#history" || window.location.hash.startsWith("#log-")) setSheet("history");
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

  /** «Подробнее — в истории» opens the history sheet on its record, without leaving the screen. */
  const openHistory = (entryId: string | null) => {
    window.history.replaceState(null, "", entryId === null ? "#history" : `#log-${entryId}`);
    setSheet("history");
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
      text: measurement.status === "not_found" ? "Счётчик не найден" : "Счётчик не проверен",
      action: { label: "Настроить", href: "/settings#site" },
    };
  }

  // The last change stands in the answer only when the review beside it does not already say it (change-history spec).
  const last = work.lastChange !== null && !(review?.changes.some((c) => c.historyId !== null && c.historyId === work.lastChange?.historyId) ?? false) ? work.lastChange : null;
  const trend = trendOf((model.daily ?? []).slice(-14));
  const state = adsState({ state: model.state, simulation: model.simulation !== null, moderationPending: model.moderation.pending, shown: work.shown.length });
  const badge = firstDay ? null : goalBadge(model.goal);
  const caption = firstDay ? (model.moderation.pending > 0 && !model.simulation ? "проверка Яндекса · первые данные завтра" : "первые данные завтра") : null;
  const period = model.dataPeriod ? words.range(model.dataPeriod.from, today) : today === "" ? "" : words.date(today);
  // What the service does next, while the ads run and there is data (analytics spec «Сводка»).
  const next = firstDay || state.kind === "paused" ? null : nextStepText(work.nextCheck, today, words);

  const status = sim.status;
  const stepping = status !== null && isStepping(status);
  const elapsed = status?.agentTurn && sim.turnSeenAt !== null ? ` · ${elapsedText(Math.max(0, Math.round((sim.now - sim.turnSeenAt) / 1_000)))}` : "";
  const thinking = status !== null && stepping ? (status.agentTurn ? `${agentTurnText(status.agentTurn)}${elapsed}` : (stepText(status) ?? "День идёт")) : null;

  return (
    <DayWordsContext.Provider value={words}>
      <div className="page brief-page">
        <h1 className="sr-only">Реклама</h1>
        <div className="brief-layout" data-side>
          <div className="brief" data-testid={firstDay ? "first-day" : "brief"}>
            <div className="brief-card panel">
              <div className="brief-date">
                <span data-testid="data-period">{period}</span>
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
                  {caption !== null ? (
                    <span>{caption}</span>
                  ) : (
                    <span>
                      за обращение ·{" "}
                      <Popover trigger="click" placement="bottomLeft" content={<p className="brief-explain">{goalExplanation(model.goal)}</p>}>
                        <button type="button" className="brief-term" data-testid="goal-term">
                          {goalText}
                        </button>
                      </Popover>
                    </span>
                  )}
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
              </div>
              {/* The pace of the money against the even plan in words, under the sum it is about (analytics spec «Сводка»). */}
              <div className="brief-pace">
                <BudgetPaceChip model={model} firstDay={firstDay} />
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
                <ChangeItem change={last} today={today} words={words} onRollback={setRollback} testId="last-change" />
              ) : null}

              {next !== null ? (
                <p className="brief-next" data-testid="next-step" title={next}>
                  <CalendarOutlined className="brief-next-icon" aria-hidden="true" />
                  <span className="brief-next-label">Дальше</span>
                  <span className="brief-next-text">{next}</span>
                </p>
              ) : null}

              {error !== null ? <Alert className="brief-error" type="error" showIcon title={error} /> : null}
            </div>

            <div className="brief-rows panel">
              <button type="button" className="brief-row" onClick={() => setSheet("ads")}>
                <span className="brief-row-icon" aria-hidden="true">
                  <NotificationOutlined />
                </span>
                <span className="brief-row-title">Объявления</span>
                <span className="brief-row-end">
                  {work.shown.length}
                  <RightOutlined className="brief-chev" aria-hidden="true" />
                </span>
              </button>
              <button type="button" className="brief-row" onClick={() => setSheet("history")}>
                <span className="brief-row-icon" aria-hidden="true">
                  <HistoryOutlined />
                </span>
                <span className="brief-row-title">История</span>
                <span className="brief-row-end" data-testid="history-count">
                  {work.changesLast7 > 0 ? `${work.changesLast7} ${plural(work.changesLast7, "изменение", "изменения", "изменений")} за неделю` : null}
                  <RightOutlined className="brief-chev" aria-hidden="true" />
                </span>
              </button>
            </div>
          </div>

          {/* The review, and in a simulation the player under it: the next step is pressed where its result is read. */}
          <div className="brief-aside">
            <ReviewRail review={review} thinking={thinking} reveal={review !== null && review.id !== openedReview.current} onRollback={setRollback} onMore={openHistory} />
            {status !== null ? <SimulationPlayer status={status} busy={sim.busy} error={sim.error} act={sim.act} scenarioTitle={work.sim?.scenarioTitle ?? null} /> : null}
          </div>
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
    </DayWordsContext.Provider>
  );
}
