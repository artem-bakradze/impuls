"use client";

import {
  BellOutlined,
  CheckOutlined,
  DownOutlined,
  EyeOutlined,
  FileSearchOutlined,
  LineChartOutlined,
  FastForwardOutlined,
  PauseCircleOutlined,
  RobotOutlined,
  RocketOutlined,
  UpOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { Alert, Button, InputNumber, Segmented } from "antd";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { PENDING_TEXT, runWebJob, runWebJobs } from "@/lib/client-api";
import type { CommandResult } from "@/lib/client-api";
import { formatCount, formatDateTime, formatLocalDate, formatRub, plural, sentence } from "@/lib/format";
import { channelLabel, compareText, goalComparable, goalLine, goalTileText, launchMonthText, moderationText, periodLead, realTimeText } from "@/lib/summary-model";
import type { SummaryModel } from "@/lib/summary-model";
import { InsightFeed } from "../insights/InsightFeed";
import { Chip, Empty, Note, PageHead, Surface, SurfaceHead } from "../ui/primitives";

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
    { state: "done", icon: <CheckOutlined />, title: "Реклама запущена", text: "Кампании созданы в вашем Яндекс Директе" },
    {
      state: checked ? "done" : "now",
      icon: checked ? <CheckOutlined /> : <FileSearchOutlined />,
      title: checked ? "Яндекс проверил объявления" : "Яндекс проверяет объявления",
      text: checked ? "Можно показывать людям" : "Обычно это занимает несколько часов",
    },
    { state: checked ? "now" : "todo", icon: <EyeOutlined />, title: "Первые показы и переходы", text: "Первые результаты появятся в течение суток" },
    { state: "todo", icon: <LineChartOutlined />, title: "Первые выводы", text: "Сервис разбирает рекламу каждое утро; через 7 дней он начнёт убирать то, что не приносит клиентов, и добавлять денег тому, что приносит" },
  ] as const;

/** The same steps in a simulation: no Yandex moderation, and the first decisions come in real seconds. */
const simulationSteps = (secondsPerDay: number) =>
  [
    { state: "done", icon: <CheckOutlined />, title: "Реклама запущена в симуляции", text: "Кампании созданы в симуляторе рынка, Яндекс Директ не нужен" },
    { state: "now", icon: <EyeOutlined />, title: "Первые показы и переходы", text: "Уже в первый виртуальный день" },
    { state: "todo", icon: <LineChartOutlined />, title: "Первые выводы", text: `На 7-й день — ${realTimeText(secondsPerDay * 6)} при текущей скорости` },
  ] as const;

/** What happens after launch, so an empty dashboard reads as «on the way», not «broken». */
function NextSteps({ moderation, simulation }: { moderation: SummaryModel["moderation"]; simulation: SummaryModel["simulation"] }) {
  const checked = moderation.pending === 0;
  const steps = simulation ? simulationSteps(simulation.secondsPerDay) : directSteps(checked);
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


export function SummaryView({ model }: { model: SummaryModel }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [clients, setClients] = useState<number | null>(null);
  const [platformsOpen, setPlatformsOpen] = useState(false);

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

  /** «Перемотать до первого решения» in a simulation: the pult's «До следующего решения». */
  const fastForward = async () => {
    setBusy("forward");
    finish(await runWebJob("/api/simulation", { action: "until_decision" }), "Перематываем до первого решения сервиса");
  };

  const answerClients = async (week: string) => {
    if (clients === null) return;
    setBusy("clients");
    finish(await runWebJob("/api/clients", { week, clients }), "Спасибо! Теперь видно, сколько стоит клиент");
  };

  const firstDay = model.state === "first_day";
  const goalChip = !goalComparable(model.goal) ? null : model.goal.status === "within" ? <Chip tone="success">В цели</Chip> : model.goal.status === "above" ? <Chip tone="warning">Дороже цели</Chip> : null;
  const sim = model.simulation;
  const monthLine = launchMonthText(model);
  const periodWord = model.compare ? (model.period === "week" ? "за 7 дней" : "за месяц") : "с запуска";
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
                  С {formatLocalDate(q.week)} по {formatLocalDate(q.weekEnd)} было обращений: {q.leads}. Сколько из них стали вашими клиентами?
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

  /** Until the service has decided something, a simulation offers to skip the wait (the first-day card has its own button). */
  const forwardButton =
    sim && !model.decided ? (
      <Button type="primary" icon={<FastForwardOutlined aria-hidden="true" />} onClick={() => void fastForward()} loading={busy === "forward"}>
        Перемотать до первого решения
      </Button>
    ) : null;

  const feed = (
    <section className="stack" style={{ "--gap": "14px" } as React.CSSProperties} data-testid="summary-feed">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="t-h2">Что сервис заметил и решил</h2>
        {!firstDay && model.feed.days.length > 0 ? forwardButton : null}
      </div>
      <InsightFeed
        feed={model.feed}
        empty={
          <Surface>
            <Empty icon={<RobotOutlined aria-hidden="true" />} title={model.launchedDays > 2 ? "За этот период разборов не было" : "Разборов пока не было"}>
              {model.launchedDays > 2
                ? "Помощник и автоматические решения в эти дни не работали — реклама шла как настроена."
                : sim
                  ? `Сервис разбирает рекламу каждое утро: первый разбор — утром 2-го виртуального дня, первые решения — на 7-й день, ${realTimeText(sim.secondsPerDay * Math.max(1, 7 - model.launchedDays))} при текущей скорости.`
                  : "Сервис разбирает рекламу каждое утро: первый разбор — завтра утром, первые решения — примерно через неделю."}
              {!firstDay && forwardButton ? <div style={{ marginTop: 12 }}>{forwardButton}</div> : null}
            </Empty>
          </Surface>
        }
      />
    </section>
  );

  const platforms = (
    <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
      <button type="button" className="link-button" style={{ alignSelf: "flex-start" }} onClick={() => setPlatformsOpen(!platformsOpen)} aria-expanded={platformsOpen}>
        {platformsOpen ? <UpOutlined aria-hidden="true" /> : <DownOutlined aria-hidden="true" />} Цифры по площадкам
      </button>
      {platformsOpen ? (
        <Surface data-testid="platforms">
          <SurfaceHead title="Где показываем рекламу" />
          <div className="surface-body" style={{ paddingTop: 4, paddingBottom: 8 }}>
            {model.directions.map((d) => (
              <div key={d.id} className="list-row" style={{ alignItems: "center" }}>
                <div className="stack" style={{ "--gap": "4px", flex: 1, minWidth: 0 } as React.CSSProperties}>
                  <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                    <span style={{ fontWeight: 600 }}>{channelLabel(d.channel)}</span>
                    {d.status === "paused" ? <Chip>на паузе</Chip> : <Chip tone="success">работает</Chip>}
                  </div>
                  <span className="t-small">
                    {d.ads} {plural(d.ads, "объявление", "объявления", "объявлений")} · лимит {formatRub(d.weeklyLimit)} в неделю
                  </span>
                </div>
                <div className="stack t-num" style={{ "--gap": "2px", textAlign: "right" } as React.CSSProperties}>
                  <span style={{ fontWeight: 600 }}>{formatRub(d.spend)}</span>
                  <span className="t-small">
                    обращений {d.leads}
                    {d.costPerLead === null ? "" : ` · ${formatRub(d.costPerLead)} за обращение`}
                  </span>
                </div>
              </div>
            ))}
            {model.directions.length === 0 ? <Note>Рекламы пока нет.</Note> : null}
          </div>
        </Surface>
      ) : null}
    </div>
  );

  return (
    <div className="page">
      <PageHead
        title="Сводка"
        lead={firstDay ? (sim ? "Симуляция только запущена" : "Реклама только запущена") : periodLead(model)}
        extra={
          // No period to switch before the first statistics arrive.
          firstDay ? null : (
          <Segmented
            value={model.period}
            options={[
              { value: "week", label: "Неделя" },
              { value: "month", label: "Месяц" },
            ]}
            onChange={(value) => router.push(`/summary?period=${value}`)}
          />
          )
        }
      />

      <div className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
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
            <Surface className="surface-pad" data-testid="first-day">
              <div className="stack" style={{ "--gap": "20px" } as React.CSSProperties}>
                <div className="row" style={{ "--gap": "14px", flexWrap: "nowrap", alignItems: "flex-start" } as React.CSSProperties}>
                  <span className="icon-tile accent" style={{ width: 44, height: 44, fontSize: 20 }}>
                    <RocketOutlined />
                  </span>
                  <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
                    <h2 className="t-h2">{sim ? "Симуляция запущена" : moderationText(model.moderation)}</h2>
                    <p className="t-body t-muted">
                      {sim
                        ? `Первые решения сервис примет на 7-й виртуальный день — это ${realTimeText(sim.secondsPerDay * 6)}. Можно не ждать.`
                        : "Первые результаты появятся в течение суток."}
                    </p>
                    {sim ? (
                      <Button type="primary" icon={<FastForwardOutlined aria-hidden="true" />} onClick={() => void fastForward()} loading={busy === "forward"} style={{ alignSelf: "flex-start", marginTop: 6 }}>
                        Перемотать до первого решения
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
            <div className="kpis">
              <div className="surface kpi kpi-hero">
                <span className="t-eyebrow">Потрачено из бюджета месяца</span>
                <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
                  <span className="v">{formatRub(model.spentMonth)}</span>
                  <span className="sub">из {formatRub(model.monthBudget)} — больше не потратим</span>
                  {monthLine ? <span className="sub" data-testid="launch-month">{monthLine}</span> : null}
                </div>
                {model.budgetForecast ? (
                  <span className="sub" data-testid="budget-forecast">
                    Осталось {formatRub(model.budgetForecast.left)}
                    {model.budgetForecast.exhaustOn ? ` — при нынешних расходах хватит примерно до ${formatLocalDate(model.budgetForecast.exhaustOn)}` : ""}
                  </span>
                ) : null}
                {model.compare ? <span className="sub">{compareText(model.spend.value, model.spend.previous, formatRub)}</span> : null}
              </div>
              <Kpi label="Обращения" value={formatCount(model.leads.value)} sub={model.compare ? compareText(model.leads.value, model.leads.previous, formatCount) : periodWord} />
              {model.clientCost.kind === "known" ? (
                <Kpi
                  label="Стоимость клиента"
                  value={model.clientCost.costPerClient === null ? "—" : formatRub(model.clientCost.costPerClient)}
                  sub={`Клиентов: ${model.clients.value === null ? "—" : formatCount(model.clients.value)} · за неделю с ${formatLocalDate(model.clientCost.week)}`}
                />
              ) : (
                <Kpi
                  label="Стоимость обращения"
                  value={model.clientCost.costPerLead === null ? "—" : formatRub(model.clientCost.costPerLead)}
                  extra={goalChip}
                  sub={
                    <>
                      <span data-testid="goal-line">{goalTileText(model.goal)}</span>
                      {/* The answer about clients is asked for only while the question is open. */}
                      {q === null ? ` · ${periodWord}` : <span style={{ display: "block" }}>{model.clientCost.hint}</span>}
                    </>
                  }
                />
              )}
            </div>

            {model.clientCost.kind === "known" ? (
              <div className="note" data-testid="goal-line" style={{ alignItems: "center" }}>
                <span style={{ flex: 1 }}>{goalLine(model.goal)}</span>
                {goalChip}
              </div>
            ) : null}

            {attention}
            {feed}
            {platforms}
            {sim ? null : <span className="t-small">Данные за последние 3 дня могут уточняться: Яндекс иногда пересчитывает расходы задним числом.</span>}
          </>
        )}

        {firstDay ? (
          <>
            {feed}
            {platforms}
          </>
        ) : null}
      </div>
    </div>
  );
}
