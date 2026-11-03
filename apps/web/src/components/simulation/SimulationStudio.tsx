"use client";

import { ExperimentOutlined, MoreOutlined } from "@ant-design/icons";
import { Alert, Button, Dropdown, Modal } from "antd";
import type { MenuProps } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatCount, formatRub, plural } from "@/lib/format";
import type { HistoryItem } from "@/lib/history-view";
import type { AdsWork } from "@/lib/server/simulation-screen";
import { agentTurnText, DIVERGED_TEXT, elapsedText, stepText, stepWeekLabel } from "@/lib/simulation-model";
import type { SimulationAction, SimulationStatus } from "@/lib/simulation-model";
import type { JournalEntry, ShownAd } from "@/lib/service-work";
import type { SummaryModel } from "@/lib/summary-model";
import { RollbackDialog } from "../history/RollbackDialog";
import { useCountUp } from "./useCountUp";
import { useSimulation } from "./useSimulation";

const leadsWord = (n: number): string => plural(n, "обращение", "обращения", "обращений");
const channelName = (channel: ShownAd["channel"]): string => (channel === "search" ? "поиск Яндекса" : "сайты-партнёры на Яндексе");

/** The first sentence of the agent's explanation, for the review card. */
const firstSentence = (text: string): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  const match = /^(.+?[.!?…])\s+(?=[А-ЯЁA-Z«])/.exec(clean);
  return match ? (match[1] ?? clean) : clean;
};

const signedRub = (delta: number): string => `${delta < 0 ? "−" : "+"}${formatRub(Math.abs(delta))}`;

/** The review is the service's latest entry, not the owner's change or the launch. */
const latestReview = (work: AdsWork): JournalEntry | null =>
  work.journal
    .flatMap((section) => section.entries)
    .filter((entry) => entry.kind === "agent" || entry.kind === "rules" || entry.kind === "quiet")
    .at(-1) ?? null;

function StudioAd({ ad, before, maxSpend }: { ad: ShownAd; before: ShownAd | null; maxSpend: number }) {
  const leads = useCountUp(ad.leads);
  const cost = useCountUp(ad.costPerLead ?? 0);
  const leadDelta = before === null ? 0 : ad.leads - before.leads;
  const costDelta = before !== null && ad.costPerLead !== null && before.costPerLead !== null ? ad.costPerLead - before.costPerLead : 0;
  const impressionsDelta = before === null ? 0 : ad.impressions - before.impressions;
  const share = maxSpend > 0 ? Math.max(2, Math.round((ad.spend / maxSpend) * 100)) : 0;
  return (
    <div className="studio-ad" data-testid="studio-ad">
      <div className="studio-ad-main">
        <span className="studio-ad-name">{ad.title}</span>
        <span className="studio-ad-sub">
          {channelName(ad.channel)} · потрачено {formatRub(ad.spend)}
          {impressionsDelta > 0 ? ` · показы +${formatCount(impressionsDelta)}` : ""}
        </span>
        {/* The ad's share of the 7 days' money against the most spending one: where the money goes, at a glance. */}
        <span className="studio-ad-bar" aria-hidden="true">
          <i style={{ width: `${share}%` }} data-verdict={ad.verdict} />
        </span>
      </div>
      <div className="studio-ad-stats">
        <span>
          {formatCount(leads)} {leadsWord(leads)}
          {leadDelta !== 0 ? <b className={leadDelta > 0 ? "studio-delta good" : "studio-delta bad"}>{leadDelta > 0 ? "+" : "−"}{Math.abs(leadDelta)}</b> : null}
        </span>
        <span className="studio-ad-cost">
          {ad.costPerLead === null ? "—" : `по ${formatRub(cost)}`}
          {costDelta !== 0 ? <b className={costDelta < 0 ? "studio-delta good" : "studio-delta bad"}>{signedRub(costDelta)}</b> : null}
        </span>
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

function Thinking({ status, elapsed }: { status: SimulationStatus; elapsed: string }) {
  const line = status.agentTurn ? `${agentTurnText(status.agentTurn)}${elapsed}` : stepText(status) ?? "День идёт";
  return (
    <div className="studio-thinking" data-testid="studio-thinking">
      <div className="studio-shimmer" />
      <div className="studio-shimmer short" />
      <p className="studio-thinking-line">
        <span className="studio-pulse" aria-hidden="true" />
        {line}
      </p>
      <p className="studio-small">Смотрим, что изменилось</p>
    </div>
  );
}

function Review({
  review,
  acknowledged,
  onAcknowledge,
  onRollback,
  status,
  busy,
  onNextDay,
  onWeek,
}: {
  review: JournalEntry;
  acknowledged: boolean;
  onAcknowledge: () => void;
  onRollback: (item: HistoryItem) => void;
  status: SimulationStatus;
  busy: boolean;
  onNextDay: () => void;
  onWeek: () => void;
}) {
  const change = review.changes[0] ?? null;
  const why = firstSentence(review.paragraphs[0] ?? review.headline ?? "");
  const facts = change?.facts ?? [];
  const canUndo = change !== null && change.item !== null && !change.reverted && change.item.rollback.kind === "available";
  const more = review.changes.length - 1;
  return (
    <div className="studio-review" data-testid="studio-review">
      {change !== null ? (
        <>
          <span className={`studio-review-tag ${change.reverted ? "muted" : "good"}`}>{change.reverted ? "Отменено" : "Уже в работе ✓"}</span>
          <p className="studio-decision">{change.text}</p>
        </>
      ) : (
        <>
          <span className="studio-review-tag muted">Разбор</span>
          <p className="studio-decision">{review.headline ?? "Изменений нет"}</p>
        </>
      )}
      {why.length > 0 && why !== review.headline ? <p className="studio-why">{why}</p> : null}
      {change !== null && !change.reverted ? (
        <div className="studio-review-actions">
          {acknowledged ? <span className="studio-ack">Оставлено</span> : <button type="button" className="studio-secondary" onClick={onAcknowledge}>Оставить как есть</button>}
          {canUndo ? <button type="button" className="studio-link" onClick={() => onRollback(change.item as HistoryItem)}>Вернуть как было</button> : null}
        </div>
      ) : null}
      {facts.length > 0 || change?.turnId ? (
        <details className="studio-facts">
          <summary>Почему так</summary>
          {facts.length > 0 ? (
            <dl>
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {change?.turnId ? <Link href={`/history/turn/${change.turnId}`}>Как сервис принял решение</Link> : null}
        </details>
      ) : null}
      {more > 0 ? <Link className="studio-link" href={`/summary#log-${review.id}`}>Ещё {more} {plural(more, "изменение", "изменения", "изменений")}</Link> : null}
      <Link className="studio-history" href={`/summary#log-${review.id}`}>История ›</Link>
      {!status.ended && !status.failed ? (
        <div className="studio-next">
          <button type="button" className="studio-primary wide" onClick={onNextDay} disabled={busy}>
            Прожить следующий день
          </button>
          <button type="button" className="studio-link" onClick={onWeek} disabled={busy}>
            {stepWeekLabel(status.daysLeft)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SimulationStudio({ model, work, initial }: { model: SummaryModel; work: AdsWork; initial: SimulationStatus }) {
  const router = useRouter();
  const { status, busy, error, act, turnSeenAt, now } = useSimulation(initial);
  const [before, setBefore] = useState<AdsWork | null>(null);
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [rollback, setRollback] = useState<HistoryItem | null>(null);
  const [modal, modalHolder] = Modal.useModal();
  const totalLeads = useCountUp(model.leads.value);
  const totalSpend = useCountUp(model.spentMonth);
  const review = latestReview(work);
  const stepping = status.status === "stepping" || status.agentTurn !== null;
  const firstDay = status.weeks === 0 && status.day === 1 && !stepping && !status.ended;
  const shownDay = status.ended ? status.totalDays : status.day;
  const done = stepping ? Math.max(0, status.day - 1) : firstDay ? 0 : shownDay;
  const tag = status.failed ? "прерван" : stepping ? "идёт" : status.ended ? "завершён" : firstDay ? "впереди" : "прожит";
  const elapsed = status.agentTurn && turnSeenAt !== null ? ` · ${elapsedText(Math.max(0, Math.round((now - turnSeenAt) / 1_000)))}` : "";
  const weekLabel = stepWeekLabel(status.daysLeft);

  const run = (control: SimulationAction) => {
    setBefore(work);
    setAcknowledged(null);
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
  const maxSpend = Math.max(0, ...work.shown.map((ad) => ad.spend));

  const stageActions = !review || stepping || status.ended || status.failed;
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
          <span className="studio-day-of">из {status.totalDays}</span>
          <span className={`studio-tag ${status.failed ? "bad" : stepping ? "live" : status.ended ? "done" : firstDay ? "muted" : "done"}`} data-testid="studio-status">{tag}</span>
        </div>
        <span className="studio-scenario">{work.sim?.scenarioTitle ?? "Симуляция"}</span>
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
        <section className="studio-stage" aria-label="День симуляции">
          <div className="studio-total">
            <span><b>{formatCount(totalLeads)}</b> {leadsWord(totalLeads)}</span>
            <span className="studio-total-sep">·</span>
            <span><b>{formatRub(totalSpend)}</b> из {formatRub(model.monthBudget)}</span>
          </div>
          <p className="studio-stage-caption">по объявлениям — за 7 дней</p>
          {work.shown.length === 0 ? <p className="studio-empty">Сейчас ни одно объявление не показывается.</p> : null}
          {work.shown.map((ad) => (
            <StudioAd key={ad.id} ad={ad} maxSpend={maxSpend} before={before?.shown.find((item) => item.id === ad.id) ?? null} />
          ))}
          {stageActions ? (
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
          ) : null}
        </section>

        <aside className="studio-rail" aria-label="Разбор" data-state={stepping ? "thinking" : review !== null ? "review" : "empty"}>
          <h2 className="studio-eyebrow">{review?.weekly ? "Разбор недели" : "Разбор дня"}</h2>
          {stepping ? (
            <Thinking status={status} elapsed={elapsed} />
          ) : review !== null ? (
            <Review
              review={review}
              acknowledged={acknowledged === review.id}
              onAcknowledge={() => setAcknowledged(review.id)}
              onRollback={setRollback}
              status={status}
              busy={busy !== null}
              onNextDay={() => run({ action: "step_day" })}
              onWeek={() => run({ action: "step_week" })}
            />
          ) : (
            <div className="studio-empty-review">
              <p>После дня здесь появится разбор: что сервис заметил и что изменил.</p>
              <Link href="/summary">История ›</Link>
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
              ? "Сервис повторит те же решения без новых запросов к модели — цифры совпадут, если вы будете действовать так же."
              : "Повторять пока нечего: в этом прогоне сервис ещё не принимал решений на модели."}
          </span>
          <Button block onClick={() => restart("fresh")}>
            Прогнать заново
          </Button>
          <span className="t-small">Сервис будет решать заново — рынок будет тем же, но агент может решить иначе.</span>
        </div>
      </Modal>

      {rollback !== null ? (
        <RollbackDialog
          item={rollback}
          items={work.history}
          names={work.names}
          onClose={(changed) => {
            setRollback(null);
            if (changed) {
              setAcknowledged(null);
              router.refresh();
            }
          }}
        />
      ) : null}
    </div>
  );
}

