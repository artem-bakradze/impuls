"use client";

import {
  BellOutlined,
  CheckOutlined,
  CoffeeOutlined,
  EyeOutlined,
  FileSearchOutlined,
  LineChartOutlined,
  PauseCircleOutlined,
  RobotOutlined,
  RocketOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { Alert, Button, InputNumber, Segmented } from "antd";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { PENDING_TEXT, runWebJob, runWebJobs } from "@/lib/client-api";
import type { CommandResult } from "@/lib/client-api";
import { formatCount, formatDateTime, formatLocalDate, formatRub, sentence } from "@/lib/format";
import { channelLabel, compareText, goalLine, moderationText } from "@/lib/summary-model";
import type { SummaryModel } from "@/lib/summary-model";
import { Chip, Empty, Note, PageHead, Surface, SurfaceHead } from "../ui/primitives";

type Feedback = { type: "success" | "error" | "info"; text: string } | null;

function Kpi({ label, value, sub, extra }: { label: string; value: string; sub?: string; extra?: ReactNode }) {
  return (
    <div className="surface kpi">
      <span className="t-eyebrow">{label}</span>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", alignItems: "flex-end" }}>
        <span className="v">{value}</span>
        {extra}
      </div>
      {sub ? <span className="sub">{sub}</span> : null}
    </div>
  );
}

/** What happens after launch, so an empty dashboard reads as «on the way», not «broken». */
function NextSteps({ moderation }: { moderation: SummaryModel["moderation"] }) {
  const checked = moderation.pending === 0;
  const steps = [
    { state: "done", icon: <CheckOutlined />, title: "Реклама запущена", text: "Кампании созданы в вашем Яндекс Директе" },
    {
      state: checked ? "done" : "now",
      icon: checked ? <CheckOutlined /> : <FileSearchOutlined />,
      title: checked ? "Яндекс проверил объявления" : "Яндекс проверяет объявления",
      text: checked ? "Можно показывать людям" : "Обычно это занимает несколько часов",
    },
    { state: checked ? "now" : "todo", icon: <EyeOutlined />, title: "Первые показы и переходы", text: "Первые результаты появятся в течение суток" },
    { state: "todo", icon: <LineChartOutlined />, title: "Первые выводы", text: "Через 7 дней сервис начнёт убирать то, что не приносит клиентов, и добавлять денег тому, что приносит" },
  ] as const;
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

  const decide = async (approvalId: string, approve: boolean) => {
    setBusy(approvalId);
    finish(await runWebJob("/api/approvals", { approvalId, approve }), approve ? "Готово — применяем изменение" : "Хорошо, не будем этого делать");
  };

  const answerClients = async (week: string) => {
    if (clients === null) return;
    setBusy("clients");
    finish(await runWebJob("/api/clients", { week, clients }), "Спасибо! Теперь видно, сколько стоит клиент");
  };

  const firstDay = model.state === "first_day";
  const spentPercent = model.monthBudget === 0 ? 0 : Math.min(100, Math.round((model.spentMonth / model.monthBudget) * 100));
  const q = model.attention.clientsQuestion;
  const attentionCount = model.attention.notifications.length + model.attention.approvals.length + (q === null ? 0 : 1);

  const attention = (
    <Surface>
      <SurfaceHead title="Нужно ваше участие" extra={attentionCount > 0 ? <Chip tone="accent">{attentionCount}</Chip> : null} />
      <div className="surface-body">
        {attentionCount === 0 ? (
          <Empty icon={<CoffeeOutlined aria-hidden="true" />} title="Сейчас ничего не нужно">
            Всё идёт по плану. Если понадобится ваше решение, оно появится здесь.
          </Empty>
        ) : null}
        <div className="stack" style={{ "--gap": "12px" } as React.CSSProperties}>
          {model.attention.approvals.map((approval) => (
            <div key={approval.id} className="note note-accent">
              <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
                <strong>Нужно ваше согласие</strong>
                <span>{approval.explanation}</span>
                <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                  <Button type="primary" onClick={() => void decide(approval.id, true)} loading={busy === approval.id}>
                    Согласен
                  </Button>
                  <Button onClick={() => void decide(approval.id, false)} disabled={busy === approval.id}>
                    Не надо
                  </Button>
                </div>
              </div>
            </div>
          ))}
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

  const actions = (
    <Surface>
      <SurfaceHead title="Что я сделал за неделю" />
      <div className="surface-body" style={{ paddingTop: 4, paddingBottom: 8 }}>
        {model.actions.length === 0 ? (
          <Empty icon={<RobotOutlined aria-hidden="true" />} title="Пока ничего не менял">
            Рекламе нужно время, чтобы набрать данные. Первые изменения — примерно через неделю.
          </Empty>
        ) : (
          model.actions.map((action) => (
            <div key={action.id} className="list-row">
              <span className="icon-tile accent">
                <RobotOutlined />
              </span>
              <div className="stack" style={{ "--gap": "3px" } as React.CSSProperties}>
                <span className="t-body">{action.text}</span>
                <span className="t-small">{formatDateTime(action.at, model.timeZone)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </Surface>
  );

  return (
    <div className="page">
      <PageHead
        title="Сводка"
        lead={model.period === "week" ? "Последние 7 дней" : "Текущий месяц"}
        extra={
          <Segmented
            value={model.period}
            options={[
              { value: "week", label: "Неделя" },
              { value: "month", label: "Месяц" },
            ]}
            onChange={(value) => router.push(`/summary?period=${value}`)}
          />
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
          <div className="grid-2">
            <Surface className="surface-pad" data-testid="first-day">
              <div className="stack" style={{ "--gap": "20px" } as React.CSSProperties}>
                <div className="row" style={{ "--gap": "14px", flexWrap: "nowrap", alignItems: "flex-start" } as React.CSSProperties}>
                  <span className="icon-tile accent" style={{ width: 44, height: 44, fontSize: 20 }}>
                    <RocketOutlined />
                  </span>
                  <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
                    <h2 className="t-h2">{moderationText(model.moderation)}</h2>
                    <p className="t-body t-muted">Первые результаты появятся в течение суток.</p>
                  </div>
                </div>
                <NextSteps moderation={model.moderation} />
              </div>
            </Surface>
            {attention}
          </div>
        ) : (
          <>
            <div className="kpis">
              <div className="surface kpi kpi-hero">
                <span className="t-eyebrow">Потрачено из бюджета месяца</span>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                  <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
                    <span className="v">{formatRub(model.spentMonth)}</span>
                    <span className="sub">из {formatRub(model.monthBudget)} · больше не потратим</span>
                  </div>
                  <span className="ring" style={{ "--p": spentPercent } as React.CSSProperties} data-label={`${spentPercent}%`} aria-label={`Потрачено ${spentPercent}% бюджета`} />
                </div>
                <span className="sub">{compareText(model.spend.value, model.spend.previous, formatRub)}</span>
              </div>
              <Kpi label="Обращения" value={formatCount(model.leads.value)} sub={compareText(model.leads.value, model.leads.previous, formatCount)} />
              {model.clientCost.kind === "known" ? (
                <Kpi
                  label="Стоимость клиента"
                  value={model.clientCost.costPerClient === null ? "—" : formatRub(model.clientCost.costPerClient)}
                  sub={`Клиентов: ${model.clients.value === null ? "—" : formatCount(model.clients.value)} · за неделю с ${formatLocalDate(model.clientCost.week)}`}
                />
              ) : (
                <Kpi label="Стоимость обращения" value={model.clientCost.costPerLead === null ? "—" : formatRub(model.clientCost.costPerLead)} sub={model.clientCost.hint} />
              )}
            </div>

            <div className="note" data-testid="goal-line" style={{ alignItems: "center" }}>
              <span style={{ flex: 1 }}>{goalLine(model.goal)}</span>
              {model.goal.status === "within" ? <Chip tone="success">В цели</Chip> : null}
              {model.goal.status === "above" ? <Chip tone="warning">Дороже цели</Chip> : null}
            </div>

            <div className="grid-2">
              {actions}
              {attention}
            </div>
            <span className="t-small">Данные за последние 3 дня могут уточняться: Яндекс иногда пересчитывает расходы задним числом.</span>
          </>
        )}

        {firstDay ? actions : null}

        <Surface>
          <SurfaceHead title="Подробнее по направлениям" />
          <div className="surface-body" style={{ paddingTop: 4, paddingBottom: 8 }}>
            {model.directions.map((d) => (
              <div key={d.id} className="list-row" style={{ alignItems: "center" }}>
                <div className="stack" style={{ "--gap": "4px", flex: 1, minWidth: 0 } as React.CSSProperties}>
                  <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                    <span style={{ fontWeight: 600 }}>{d.name}</span>
                    {d.status === "paused" ? <Chip>на паузе</Chip> : <Chip tone="success">работает</Chip>}
                  </div>
                  <span className="t-small">{channelLabel(d.channel)}</span>
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
            {model.directions.length === 0 ? <Note>Направлений пока нет.</Note> : null}
          </div>
        </Surface>
      </div>
    </div>
  );
}
