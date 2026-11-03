"use client";

import { addDays } from "@impuls/core";
import {
  BellOutlined,
  CheckOutlined,
  EyeOutlined,
  FileSearchOutlined,
  LineChartOutlined,
  FastForwardOutlined,
  PauseCircleOutlined,
  RocketOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { Alert, Button, InputNumber } from "antd";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { PENDING_TEXT, runWebJob, runWebJobs } from "@/lib/client-api";
import type { CommandResult } from "@/lib/client-api";
import { formatCount, formatDateTime, formatLocalDate, formatRub, sentence } from "@/lib/format";
import type { AdsWork } from "@/lib/server/simulation-screen";
import { compareText, goalComparable, goalTileText, launchMonthText, moderationText, periodLead } from "@/lib/summary-model";
import type { SummaryModel } from "@/lib/summary-model";
import { ComparisonNote, WorkArea } from "../ads/WorkArea";
import { MeasurementNotice } from "../MeasurementNotice";
import { Chip, PageHead, Surface, SurfaceHead } from "../ui/primitives";

type Feedback = { type: "success" | "error" | "info"; text: string } | null;

function Kpi({ label, value, sub, extra }: { label: string; value: string; sub?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="surface kpi">
      <span className="t-eyebrow">{label}</span>
      {/* The goal's status goes under the number when a half-width tile on a phone has no room for both. */}
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", alignItems: "flex-end", "--gap": "6px" } as React.CSSProperties}>
        <span className="v">{value}</span>
        {extra}
      </div>
      {sub ? <span className="sub">{sub}</span> : null}
    </div>
  );
}

/** After launch with Direct: moderation, first impressions, first decisions. */
const directSteps = (checked: boolean) =>
  [
    { state: "done", icon: <CheckOutlined />, title: "Реклама запущена", text: "Реклама создана в вашем Яндекс Директе" },
    {
      state: checked ? "done" : "now",
      icon: checked ? <CheckOutlined /> : <FileSearchOutlined />,
      title: checked ? "Яндекс проверил объявления" : "Яндекс проверяет объявления",
      text: checked ? "Можно показывать людям" : "Обычно это занимает несколько часов",
    },
    { state: checked ? "now" : "todo", icon: <EyeOutlined />, title: "Первые просмотры рекламы", text: "Первые результаты появятся в течение суток" },
    { state: "todo", icon: <LineChartOutlined />, title: "Первые выводы", text: "Сервис разбирает рекламу каждое утро; через 7 дней он начнёт убирать то, что не приносит клиентов, и добавлять денег тому, что приносит" },
  ] as const;

/** The same steps in a simulation: no Yandex moderation, and the first decisions usually come in the first week. */
const simulationSteps = () =>
  [
    { state: "done", icon: <CheckOutlined />, title: "Реклама запущена в симуляции", text: "Реклама создана в симуляторе рынка, Яндекс Директ не нужен" },
    { state: "now", icon: <EyeOutlined />, title: "Первые просмотры рекламы", text: "Уже в первый виртуальный день" },
    { state: "todo", icon: <LineChartOutlined />, title: "Первые выводы", text: "Обычно в первую неделю: нажмите «Прожить первую неделю»" },
  ] as const;

/** What happens after launch, so an empty dashboard reads as «on the way», not «broken». */
function NextSteps({ moderation, simulation }: { moderation: SummaryModel["moderation"]; simulation: SummaryModel["simulation"] }) {
  const checked = moderation.pending === 0;
  const steps = simulation ? simulationSteps() : directSteps(checked);
  return (
    <ol className="timeline">
      {steps.map((s) => (
        <li key={s.title} data-state={s.state}>
          <span className="tl-dot">{s.icon}</span>
          <div className="stack" style={{ "--gap": "2px", paddingTop: 3 } as React.CSSProperties}>
            <span style={{ fontWeight: 600 }}>{s.title}</span>
            <span className="t-small">{s.text}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}


/** «Реклама» (analytics spec «Главный экран «Реклама»»): the month's three numbers, the owner's tasks, the ads and the journal. */
export function SummaryView({ model, work, focusWeek = null }: { model: SummaryModel; work: AdsWork; focusWeek?: number | null }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [clients, setClients] = useState<number | null>(null);

  const finish = (outcome: { kind: "done" } | { kind: "pending" } | { kind: "error"; message: string }, success: string) => {
    if (outcome.kind === "done") {
      setFeedback({ type: "success", text: success });
      router.refresh();
    } else if (outcome.kind === "pending") {
      setFeedback({ type: "info", text: PENDING_TEXT });
    } else {
      setFeedback({ type: "error", text: outcome.message });
    }
    setBusy(null);
  };

  const resume = async () => {
    setBusy("resume");
    const outcome = await runWebJobs<CommandResult>("/api/commands", { action: "resumeAll" });
    const failed = outcome.kind === "done" ? outcome.output.find((r) => r.status === "rejected" || r.status === "failed") : undefined;
    finish(failed ? { kind: "error", message: sentence(failed.message) } : outcome, "Реклама снова работает");
  };

  /** «Прожить первую неделю» on the first-day card: the pult's «Прожить неделю». */
  const liveWeek = async () => {
    setBusy("forward");
    finish(await runWebJob("/api/simulation", { action: "step_week" }), "Неделя прожита — что сделал сервис, видно в журнале");
  };
  const weekLabel = model.simulation?.weeks === 0 ? "Прожить первую неделю" : "Прожить неделю";

  const answerClients = async (week: string) => {
    if (clients === null) return;
    setBusy("clients");
    finish(await runWebJob("/api/clients", { week, clients }), "Спасибо! Теперь видно, сколько стоит клиент");
  };

  const firstDay = model.state === "first_day";
  const goalChip = !goalComparable(model.goal) ? null : model.goal.status === "within" ? <Chip tone="success">В цели</Chip> : model.goal.status === "above" ? <Chip tone="warning">Дороже цели</Chip> : null;
  const sim = model.simulation;
  const monthLine = launchMonthText(model);
  const periodWord = model.compare ? "за месяц" : "с запуска";
  const q = model.attention.clientsQuestion;
  const attentionCount = model.attention.notifications.length + (q === null ? 0 : 1);

  // An empty «Нужно ваше участие» is not shown: it only took space (analytics spec).
  const attention =
    attentionCount === 0 ? null : (
    <Surface>
      <SurfaceHead title="Нужно ваше участие" extra={<Chip tone="accent">{attentionCount}</Chip>} />
      <div className="surface-body">
        <div className="stack" style={{ "--gap": "12px" } as React.CSSProperties}>
          {q ? (
            <div className="note" data-testid="clients-question">
              <span className="note-icon">
                <UserAddOutlined />
              </span>
              <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
                <strong style={{ color: "var(--text)" }}>Сколько обращений стали клиентами?</strong>
                <span>
                  С {formatLocalDate(q.week)} по {formatLocalDate(q.weekEnd)} было обращений: {q.leads}.
                </span>
                <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                  <InputNumber min={0} max={q.leads} value={clients} onChange={(v) => setClients(typeof v === "number" ? Math.round(v) : null)} aria-label="Сколько стали клиентами" />
                  <Button type="primary" onClick={() => void answerClients(q.week)} disabled={clients === null} loading={busy === "clients"}>
                    Ответить
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          {model.attention.notifications.map((n) => (
            <div key={n.id} className="list-row" style={{ padding: 0, border: 0 }}>
              <span className="icon-tile warning">
                <BellOutlined />
              </span>
              <div className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
                <span>{n.message}</span>
                <span className="t-small">{formatDateTime(n.at, model.timeZone)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Surface>
  );

  const heading = (
    <PageHead title="Реклама" lead={firstDay ? (sim ? "Симуляция только запущена" : "Реклама только запущена") : !model.compare ? periodLead(model) : undefined} />
  );

  return (
    <div className="page summary-page">
      {firstDay ? heading : null}

      <div className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
        {model.measurement && !sim ? <MeasurementNotice model={model.measurement} readOnly /> : null}
        {feedback ? <Alert type={feedback.type} showIcon title={feedback.text} closable={{ onClose: () => setFeedback(null) }} /> : null}

        {model.state === "paused" ? (
          <div className="note note-warning" style={{ alignItems: "center" }}>
            <span className="note-icon">
              <PauseCircleOutlined />
            </span>
            <strong style={{ flex: 1 }}>Реклама на паузе</strong>
            <Button type="primary" onClick={() => void resume()} loading={busy === "resume"}>
              Возобновить
            </Button>
          </div>
        ) : null}

        {firstDay ? (
          <div className={attention ? "grid-2" : "stack"}>
            <Surface className="surface-pad first-day" data-testid="first-day">
              <div className="stack" style={{ "--gap": "20px" } as React.CSSProperties}>
                <div className="row" style={{ "--gap": "14px", flexWrap: "nowrap", alignItems: "flex-start" } as React.CSSProperties}>
                  <span className="icon-tile accent" style={{ width: 44, height: 44, fontSize: 20 }}>
                    <RocketOutlined />
                  </span>
                  <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
                    <h2 className="t-h2">{sim ? "Симуляция запущена" : moderationText(model.moderation)}</h2>
                    <p className="t-body t-muted">
                      {sim
                        ? "Первые решения сервис обычно принимает в первую неделю. Проживите её за один шаг — и посмотрите, что он заметил и решил."
                        : "Первые результаты появятся в течение суток."}
                    </p>
                    {sim ? (
                      <Button type="primary" icon={<FastForwardOutlined aria-hidden="true" />} onClick={() => void liveWeek()} loading={busy === "forward"} style={{ alignSelf: "flex-start", marginTop: 6 }}>
                        {weekLabel}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <NextSteps moderation={model.moderation} simulation={sim} />
                <div className="note" data-testid="first-day-budget">
                  <div className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
                    <span>
                      Потрачено {formatRub(model.spentMonth)} из {formatRub(model.monthBudget)} в этом месяце — больше не потратим
                    </span>
                    {monthLine ? <span className="t-small">{monthLine}</span> : null}
                  </div>
                </div>
              </div>
            </Surface>
            {attention}
          </div>
        ) : (
          <>
            <section className="summary-overview" aria-label="Результаты рекламы">
            <div className="summary-heading">{heading}</div>
            <div className="summary-period" data-testid="data-period">
              <span>{model.dataPeriod ? `${formatLocalDate(model.dataPeriod.from)} — ${formatLocalDate(model.dataPeriod.to)} · текущий день неполный` : periodWord}</span>
            </div>
            <div className="kpis summary-kpis">
              <Kpi label="Обращения" value={formatCount(model.leads.value)} sub={model.compare ? compareText(model.leads.value, model.leads.previous, formatCount) : periodWord} />
              <Kpi label="Цена обращения" value={model.goal.current === null ? "—" : formatRub(model.goal.current)} extra={goalChip} sub={<span data-testid="goal-line">{goalTileText(model.goal)}</span>} />
              <div className="surface kpi budget-kpi" data-testid="budget-tile">
                <span className="t-eyebrow">Потрачено</span>
                <span className="v">{formatRub(model.spentMonth)}</span>
                <span className="budget-bar" aria-label={`Потрачено ${formatRub(model.spentMonth)} из ${formatRub(model.monthBudget)}`}><i style={{ width: `${model.monthBudget > 0 ? Math.min(100, (model.spentMonth / model.monthBudget) * 100) : 0}%` }} /></span>
                <span className="sub">из {formatRub(model.monthBudget)} · сервис сам держит расход в бюджете месяца</span>
                {monthLine ? <span className="sub" data-testid="launch-month">{monthLine}</span> : null}
                {model.budgetForecast ? <span className="sub" data-testid="budget-forecast">Осталось {formatRub(model.budgetForecast.left)}{model.budgetForecast.exhaustOn ? ` — хватит примерно до ${formatLocalDate(model.budgetForecast.exhaustOn)}` : ""}</span> : null}
              </div>
            </div>
            {work.sim ? <ComparisonNote sim={work.sim} /> : null}
            </section>
            {model.clientCost.kind === "known" ? <details className="context-details"><summary>Подтверждённые клиенты</summary><p>Клиентов: {formatCount(model.clientCost.clients)} · {formatLocalDate(model.clientCost.week)} — {formatLocalDate(addDays(model.clientCost.week, 6))}</p><p>Стоимость клиента: {model.clientCost.costPerClient === null ? "—" : formatRub(model.clientCost.costPerClient)}</p></details> : null}

            {attention}
          </>
        )}

        <WorkArea work={work} focusWeek={focusWeek} />
        {sim || firstDay ? null : <span className="t-small">Данные за последние 3 дня могут уточняться: Яндекс иногда пересчитывает расходы задним числом.</span>}
      </div>
    </div>
  );
}
