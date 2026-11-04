"use client";

import { CheckCircleFilled, ExperimentOutlined, MoreOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Modal } from "antd";
import type { MenuProps } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { formatCount, formatLocalDate, formatRange, formatRub, plural } from "@/lib/format";
import type { HistoryItem } from "@/lib/history-view";
import type { AdsWork } from "@/lib/server/simulation-screen";
import { agentTurnText, DIVERGED_TEXT, elapsedText, stepText, stepWeekLabel } from "@/lib/simulation-model";
import type { SimulationAction, SimulationStatus } from "@/lib/simulation-model";
import { noteExpect, noteSeen, noteSentence, noteTitle } from "@/lib/review-note";
import { adResult } from "@/lib/ad-result";
import type { GoalWord } from "@/lib/ad-result";
import { VERDICT_WORD, verdictRule } from "@/lib/service-work";
import type { JournalEntry, ShownAd } from "@/lib/service-work";
import { goalComparable, goalExplanation } from "@/lib/summary-model";
import type { SummaryModel } from "@/lib/summary-model";
import { RollbackDialog } from "../history/RollbackDialog";
import { LogoMark } from "../ui/Logo";
import { BudgetPaceChip, NumbersCard, ResultChip } from "../ui/ResultChip";
import { useCountUp } from "./useCountUp";
import { useSimulation } from "./useSimulation";

const leadsWord = (n: number): string => plural(n, "обращение", "обращения", "обращений");
const channelName = (channel: ShownAd["channel"]): string => (channel === "search" ? "поиск" : "сайты-партнёры");

/** The review is the service's latest entry, not the owner's change or the launch. */
const latestReview = (work: AdsWork): JournalEntry | null =>
  work.journal
    .flatMap((section) => section.entries)
    .filter((entry) => entry.kind === "agent" || entry.kind === "rules" || entry.kind === "quiet")
    .at(-1) ?? null;

/** The ad's 7 days in numbers with the rule of its estimate: what opens on its result (simulation-mode spec «Подписи студии»). */
function AdNumbers({ ad, cso, goalWord }: { ad: ShownAd; cso: number; goalWord: GoalWord }) {
  const word = VERDICT_WORD[ad.verdict];
  const rows: [string, string][] = [
    ["Потрачено", formatRub(ad.spend)],
    ["Обращения", formatCount(ad.leads)],
    ["Цена обращения", ad.costPerLead === null ? "—" : formatRub(ad.costPerLead)],
    [goalWord === "цели" ? "Цель" : "Ориентир", formatRub(cso)],
    ["Переходы на сайт", formatCount(ad.clicks)],
    ["Показы", formatCount(ad.impressions)],
  ];
  const note = (
    <>
      <b>{`${word.slice(0, 1).toUpperCase()}${word.slice(1)}`}</b> — {verdictRule(ad.verdict, cso)}.
    </>
  );
  return <NumbersCard title="За 7 дней" rows={rows} note={note} testId="studio-ad-numbers" />;
}

/**
 * One ad as people see it in Yandex — the site, the title, the text — with one result under it: its cost per lead against
 * the goal in words, its leads and the service's estimate. The numbers behind the result open on it, by hover or tap.
 */
function StudioAd({ ad, before, site, cso, goalWord }: { ad: ShownAd; before: ShownAd | null; site: string; cso: number; goalWord: GoalWord }) {
  const leads = useCountUp(ad.leads);
  const leadDelta = before === null ? 0 : ad.leads - before.leads;
  const result = adResult(ad, cso, goalWord);
  return (
    <article className="studio-ad" data-testid="studio-ad">
      <div className="studio-ad-meta">
        {site === "" ? null : (
          <span className="ad-row-favicon" aria-hidden="true">
            {site.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="studio-ad-site">{site === "" ? channelName(ad.channel) : `${site} · ${channelName(ad.channel)}`}</span>
      </div>
      <h3 className="studio-ad-title">{ad.title}</h3>
      <p className="studio-ad-text">{ad.text}</p>
      <div className="studio-ad-foot">
        <ResultChip result={result} numbers={<AdNumbers ad={ad} cso={cso} goalWord={goalWord} />} testId="studio-ad-result" />
        <p className="studio-ad-state">
          <span className="studio-ad-verdict" data-verdict={ad.verdict}>
            <i aria-hidden="true" />
            <span data-testid="studio-ad-verdict">{VERDICT_WORD[ad.verdict]}</span>
          </span>
          {ad.leads > 0 ? (
            <span className="studio-ad-leads">
              {formatCount(leads)} {leadsWord(leads)}
              {leadDelta > 0 ? <b className="studio-delta good">+{formatCount(leadDelta)}</b> : null}
            </span>
          ) : null}
        </p>
      </div>
    </article>
  );
}

/**
 * The totals of the period over the ads as two cards that read like an ad's (simulation-mode spec «Итог студии»): leads
 * with their cost against the goal in words, and the month's money with its pace against the even plan in words. The
 * numbers and what the goal and the plan are open on the words. After a step the leads and the money show what it added.
 */
function StudioSummary({ model, before, firstDay }: { model: SummaryModel; before: { leads: number; spend: number } | null; firstDay: boolean }) {
  const leads = useCountUp(model.leads.value);
  const spend = useCountUp(model.spentMonth);
  const cost = useCountUp(model.goal.current ?? 0);
  const leadDelta = before === null ? 0 : model.leads.value - before.leads;
  const spendDelta = before === null ? 0 : model.spentMonth - before.spend;
  const goalWord: GoalWord = goalComparable(model.goal) ? "цели" : "ориентира";
  const result = adResult({ leads: model.leads.value, costPerLead: model.goal.current }, model.goal.cso, goalWord);
  const period = model.dataPeriod ? formatRange(model.dataPeriod.from, model.dataPeriod.to) : null;
  const share = model.monthBudget > 0 ? Math.min(100, (model.spentMonth / model.monthBudget) * 100) : 0;
  const barTone = model.monthBudget > 0 && model.spentMonth >= model.monthBudget ? "danger" : model.budgetForecast !== null ? "warning" : undefined;

  const leadsNumbers = (
    <NumbersCard
      title={period ?? "Обращения"}
      rows={[
        ["Обращения", formatCount(model.leads.value)],
        ["Цена обращения", model.goal.current === null ? "—" : formatRub(model.goal.current)],
        [goalWord === "цели" ? "Цель" : "Ориентир", formatRub(model.goal.cso)],
      ]}
      note={goalExplanation(model.goal)}
      testId="studio-leads-numbers"
    />
  );

  return (
    <div className="studio-summary" data-testid="studio-summary">
      <h2 className="studio-ads-head">{period === null ? "Итог" : `Итог · ${period}`}</h2>
      <div className="studio-sum">
        <section className="studio-tile" data-testid="studio-leads">
          <h3 className="studio-tile-label">Обращения</h3>
          <p className="studio-tile-value">
            {formatCount(leads)}
            {leadDelta > 0 ? <b className="studio-delta good">+{formatCount(leadDelta)}</b> : null}
          </p>
          {model.goal.current === null ? null : <p className="studio-tile-sub">по {formatRub(cost)} за обращение</p>}
          <ResultChip result={result} numbers={leadsNumbers} testId="studio-leads-result" />
        </section>
        <section className="studio-tile" data-testid="studio-money">
          <h3 className="studio-tile-label">Потрачено</h3>
          <p className="studio-tile-value">
            {formatRub(spend)}
            <span className="studio-tile-of">из {formatRub(model.monthBudget)}</span>
            {spendDelta > 0 ? <b className="studio-delta">+{formatRub(spendDelta)}</b> : null}
          </p>
          <span className="studio-tile-bar" data-tone={barTone} aria-hidden="true">
            <i style={{ width: `${share}%` }} />
          </span>
          <BudgetPaceChip model={model} firstDay={firstDay} />
        </section>
      </div>
    </div>
  );
}

function DayStrip({ total, done, now }: { total: number; done: number; now: boolean }) {
  return (
    <div className="studio-strip" style={{ gridTemplateColumns: `repeat(${Math.max(1, total)}, minmax(0, 1fr))` }} aria-hidden="true">
      {Array.from({ length: Math.max(1, total) }, (_, index) => (
        <i key={index} data-state={index < done ? "done" : now && index === done ? "now" : "todo"} />
      ))}
    </div>
  );
}

/**
 * Who speaks in the rail: the service's mark, its name and what the message is about (simulation-mode spec «Симуляция
 * как отдельный режим»). The heading is the day of the record, so the review is found by it.
 */
function MessageHead({ title }: { title: string }) {
  return (
    <header className="studio-msg-head">
      <span className="studio-avatar">
        <LogoMark size={36} />
      </span>
      <span className="studio-msg-who">
        <span className="studio-msg-name">Импульс</span>
        <h2 className="studio-msg-title">{title}</h2>
      </span>
    </header>
  );
}

/** While the day goes, the service is typing: running dots in its bubble and the step's line under it. */
function Thinking({ status, elapsed }: { status: SimulationStatus; elapsed: string }) {
  const line = status.agentTurn ? `${agentTurnText(status.agentTurn)}${elapsed}` : stepText(status) ?? "День идёт";
  return (
    <div className="studio-thinking" data-testid="studio-thinking">
      <div className="studio-bubble studio-typing" role="status" aria-label="Сервис пишет разбор">
        <i />
        <i />
        <i />
      </div>
      <p className="studio-thinking-line">{line}</p>
    </div>
  );
}

/**
 * The review as the service's message, in its own words and without section labels (simulation-mode spec «Симуляция как
 * отдельный режим»): the reasoning and what the checks found, each change as a done action with its undo, then what the
 * service expects and when it checks. A review that arrives on the owner's eyes shows part by part; the text is the one
 * already written, and with reduced motion it is all there at once.
 */
function Review({ review, reveal, onRollback }: { review: JournalEntry; reveal: boolean; onRollback: (item: HistoryItem) => void }) {
  const seen = noteSeen(review);
  const expected = noteExpect(review);
  let part = 0;
  const order = () => ({ "--i": part++ }) as CSSProperties;
  return (
    <article className={reveal ? "studio-msg studio-msg-reveal" : "studio-msg"} data-testid="studio-review">
      <div className="studio-bubble">
        {seen.map((text, i) => (
          <p key={`seen-${i}`} className="studio-msg-text" style={order()}>
            {text}
          </p>
        ))}
        {review.changes.map((change, i) => {
          const undoable = change.item !== null && !change.reverted && change.item.rollback.kind === "available";
          return (
            <div key={change.historyId ?? `change-${i}`} className="studio-msg-action" data-reverted={change.reverted || undefined} style={order()}>
              <CheckCircleFilled className="studio-msg-done" aria-label={change.reverted ? "отменено" : "сделано"} />
              <span className="studio-msg-action-text">
                {noteSentence(change.text)}
                {change.reverted ? <span className="studio-msg-dim"> — вы вернули как было</span> : null}.
              </span>
              {undoable ? (
                <button type="button" className="studio-msg-undo" onClick={() => onRollback(change.item as HistoryItem)}>
                  Вернуть как было
                </button>
              ) : null}
            </div>
          );
        })}
        {expected.length > 0 ? (
          <p className="studio-msg-text" style={order()}>
            {expected.join(" ")}
          </p>
        ) : null}
      </div>
      <Link className="studio-msg-more" href={`/summary#log-${review.id}`} style={order()}>
        Подробнее — в истории ›
      </Link>
    </article>
  );
}

export function SimulationStudio({ model, work, initial }: { model: SummaryModel; work: AdsWork; initial: SimulationStatus }) {
  const router = useRouter();
  const { status, busy, error, act, turnSeenAt, now } = useSimulation(initial);
  // What the screen showed before the step, so the ads and the totals can say what the step changed.
  const [before, setBefore] = useState<{ work: AdsWork; leads: number; spend: number } | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [rollback, setRollback] = useState<HistoryItem | null>(null);
  const [modal, modalHolder] = Modal.useModal();
  const review = latestReview(work);
  // The review the page opened with is shown at once; one that arrives after a step is written part by part.
  const openedReview = useRef(review?.id ?? null);
  const stepping = status.status === "stepping" || status.agentTurn !== null;
  const firstDay = status.weeks === 0 && status.day === 1 && !stepping && !status.ended;
  const shownDay = status.ended ? status.totalDays : status.day;
  const done = stepping ? Math.max(0, status.day - 1) : firstDay ? 0 : shownDay;
  const tag = status.failed ? "прерван" : stepping ? "идёт" : status.ended ? "завершён" : firstDay ? "впереди" : "прожит";
  const elapsed = status.agentTurn && turnSeenAt !== null ? ` · ${elapsedText(Math.max(0, Math.round((now - turnSeenAt) / 1_000)))}` : "";
  const weekLabel = stepWeekLabel(status.daysLeft);

  const run = (control: SimulationAction) => {
    setBefore({ work, leads: model.leads.value, spend: model.spentMonth });
    void act(control);
  };

  const restart = (mode: "repeat" | "fresh") => {
    setRestartOpen(false);
    void act({ action: "restart", mode });
  };

  const confirmGoReal = () =>
    modal.confirm({
      title: "Запустить настоящую рекламу?",
      content: "Данные симуляции удалятся без возможности вернуть. Описание бизнеса, бюджет и объявления сохранятся.",
      okText: "Запустить по-настоящему",
      cancelText: "Отмена",
      onOk: () => act({ action: "go_real" }),
    });

  const menu: MenuProps = {
    items: [{ key: "restart", label: "Начать заново", disabled: stepping }],
    onClick: ({ key }) => {
      if (key === "restart") setRestartOpen(true);
    },
  };
  const goalWord: GoalWord = goalComparable(model.goal) ? "цели" : "ориентира";

  const primaryLabel = status.ended
    ? "Продолжить ещё 30 дней"
    : status.failed
      ? "Продолжить расчёт"
      : stepping
        ? status.agentTurn
          ? "Сервис разбирает…"
          : "День идёт…"
        : firstDay
          ? "Прожить день"
          : "Прожить следующий день";

  const primary = () => {
    if (status.ended) return run({ action: "extend" });
    if (status.failed) return run({ action: "step_week" });
    return run({ action: "step_day" });
  };

  return (
    <div className="page studio-page">
      {modalHolder}
      <div className="studio-head">
        <div className="studio-day">
          <span className="studio-day-num" data-testid="studio-day">День {shownDay}</span>
          <span className="studio-day-of">
            из {status.totalDays}
            {model.dataPeriod ? ` · ${formatLocalDate(model.dataPeriod.to)}` : ""}
          </span>
          <span className={`studio-tag ${status.failed ? "bad" : stepping ? "live" : status.ended ? "done" : firstDay ? "muted" : "done"}`} data-testid="studio-status">{tag}</span>
        </div>
        <span className="studio-scenario" data-testid="studio-scenario">{work.sim?.scenarioTitle ? `сценарий «${work.sim.scenarioTitle}»` : "симуляция"}</span>
        <Button className="studio-go-real" onClick={() => void confirmGoReal()} disabled={stepping}>
          Запустить по-настоящему
        </Button>
        <Dropdown menu={menu} trigger={["click"]} placement="bottomRight">
          <Button type="text" icon={<MoreOutlined aria-hidden="true" />} aria-label="Ещё: начать заново" className="studio-menu" />
        </Dropdown>
      </div>
      <DayStrip total={status.totalDays} done={done} now={stepping} />
      <p className="studio-disclaimer" data-testid="studio-disclaimer">
        <ExperimentOutlined aria-hidden="true" /> Учебный рынок · деньги не списываются
      </p>
      {status.replay.diverged ? <Alert className="studio-alert" type="info" showIcon title={DIVERGED_TEXT} /> : null}
      {error !== null ? <Alert className="studio-alert" type="error" showIcon title={error} /> : null}

      <div className="studio-grid">
        <section className="studio-stage panel" aria-label="День симуляции">
          <StudioSummary model={model} before={before} firstDay={firstDay} />
          <div className="studio-ads">
            <h2 className="studio-ads-head">Объявления · за 7 дней</h2>
            {work.shown.length === 0 ? <p className="studio-empty">Сейчас ни одно объявление не показывается.</p> : null}
            <div className="studio-ad-grid">
              {work.shown.map((ad) => (
                <StudioAd key={ad.id} ad={ad} site={work.site} cso={work.cso} goalWord={goalWord} before={before?.work.shown.find((item) => item.id === ad.id) ?? null} />
              ))}
            </div>
          </div>
          <div className="studio-actions">
            <button type="button" className="studio-primary" onClick={primary} disabled={stepping || busy !== null}>
              {primaryLabel}
            </button>
            {!status.ended && !status.failed && !stepping ? (
              <button type="button" className="studio-link" onClick={() => run({ action: "step_week" })} disabled={busy !== null}>
                {weekLabel}
              </button>
            ) : null}
          </div>
        </section>

        <aside className="studio-rail panel" aria-label="Разбор" data-state={stepping ? "thinking" : review !== null ? "review" : "empty"}>
          <MessageHead title={stepping ? "Разбирает день" : review === null ? "Разбор дня" : noteTitle(review)} />
          {stepping ? (
            <Thinking status={status} elapsed={elapsed} />
          ) : review !== null ? (
            <Review key={review.id} review={review} reveal={review.id !== openedReview.current} onRollback={setRollback} />
          ) : (
            <div className="studio-msg studio-empty-review">
              <p className="studio-bubble">После первого дня я напишу здесь, что заметил в рекламе и что изменил.</p>
              <Link className="studio-msg-more" href="/summary">
                История ›
              </Link>
            </div>
          )}
        </aside>
      </div>

      <Modal open={restartOpen} title="Начать симуляцию заново?" onCancel={() => setRestartOpen(false)} footer={null}>
        <div className="studio-modal">
          <p className="t-body t-muted">Тот же сценарий с первого дня: рынок будет тем же. История и цифры этого прогона удалятся.</p>
          <Button type="primary" block onClick={() => restart("repeat")} disabled={!status.replay.available}>
            Повторить этот прогон
          </Button>
          <span className="t-small">
            {status.replay.available
              ? "Сервис повторит те же решения — цифры совпадут, если вы будете действовать так же."
              : "Повторять пока нечего: в этом прогоне сервис ещё не принимал своих решений."}
          </span>
          <Button block onClick={() => restart("fresh")}>
            Прогнать заново
          </Button>
          <span className="t-small">Рынок будет тем же, но сервис будет решать заново и может решить иначе.</span>
        </div>
      </Modal>

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

