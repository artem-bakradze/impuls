"use client";

import { Alert, Button, Card, Collapse, Empty, Flex, InputNumber, List, Progress, Segmented, Space, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PENDING_TEXT, runWebJob, runWebJobs } from "@/lib/client-api";
import type { CommandResult } from "@/lib/client-api";
import { formatCount, formatDateTime, formatLocalDate, formatRub, sentence } from "@/lib/format";
import { channelLabel, compareText, goalLine, moderationText } from "@/lib/summary-model";
import type { SummaryModel } from "@/lib/summary-model";

type Feedback = { type: "success" | "error" | "info"; text: string } | null;

function Stat({ title, value, note, children }: { title: string; value: string; note?: string; children?: React.ReactNode }) {
  return (
    <Card size="small">
      <Typography.Text type="secondary">{title}</Typography.Text>
      <div style={{ fontSize: 24, fontWeight: 600 }}>{value}</div>
      {children}
      {note ? (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {note}
        </Typography.Text>
      ) : null}
    </Card>
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
  const attentionEmpty = model.attention.notifications.length === 0 && model.attention.approvals.length === 0 && q === null;

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Сводка
        </Typography.Title>
        <Segmented
          value={model.period}
          options={[
            { value: "week", label: "Неделя" },
            { value: "month", label: "Месяц" },
          ]}
          onChange={(value) => router.push(`/summary?period=${value}`)}
        />
      </Flex>

      {feedback ? <Alert type={feedback.type} showIcon title={feedback.text} closable={{ onClose: () => setFeedback(null) }} /> : null}

      {model.state === "paused" ? (
        <Alert
          type="warning"
          showIcon
          title="Реклама на паузе"
          action={
            <Button type="primary" onClick={() => void resume()} loading={busy === "resume"}>
              Возобновить
            </Button>
          }
        />
      ) : null}

      {firstDay ? (
        <Card data-testid="first-day">
          <Typography.Title level={4} style={{ marginTop: 0 }}>
            {moderationText(model.moderation)}
          </Typography.Title>
          <Typography.Paragraph style={{ margin: 0 }}>Первые результаты появятся в течение суток.</Typography.Paragraph>
        </Card>
      ) : (
        <>
          <div className="stat-grid">
            <Stat title="Потрачено из бюджета месяца" value={`${formatRub(model.spentMonth)} из ${formatRub(model.monthBudget)}`} note={compareText(model.spend.value, model.spend.previous, formatRub)}>
              <Progress percent={spentPercent} size="small" />
            </Stat>
            <Stat title="Обращения" value={formatCount(model.leads.value)} note={compareText(model.leads.value, model.leads.previous, formatCount)} />
            <Stat
              title="Клиенты"
              value={model.clients.value === null ? "—" : formatCount(model.clients.value)}
              note={model.clients.value === null ? "Вы ещё не отвечали, сколько обращений стали клиентами" : compareText(model.clients.value, model.clients.previous ?? 0, formatCount)}
            />
            {model.clientCost.kind === "known" ? (
              <Stat
                title="Стоимость клиента"
                value={model.clientCost.costPerClient === null ? "—" : formatRub(model.clientCost.costPerClient)}
                note={`за неделю с ${formatLocalDate(model.clientCost.week)}`}
              />
            ) : (
              <Stat
                title="Стоимость обращения"
                value={model.clientCost.costPerLead === null ? "—" : formatRub(model.clientCost.costPerLead)}
                note={model.clientCost.hint}
              />
            )}
          </div>
          <Card size="small" data-testid="goal-line">
            <Space wrap>
              <Typography.Text>{goalLine(model.goal)}</Typography.Text>
              {model.goal.status === "within" ? <Tag color="green">В цели</Tag> : null}
              {model.goal.status === "above" ? <Tag color="orange">Дороже цели</Tag> : null}
            </Space>
          </Card>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Данные за последние 3 дня могут уточняться: Яндекс иногда пересчитывает расходы задним числом.
          </Typography.Text>
        </>
      )}

      <Card title="Нужно ваше участие" size="small">
        {attentionEmpty ? <Typography.Text type="secondary">Сейчас ничего не нужно — всё идёт по плану.</Typography.Text> : null}
        <Flex vertical gap={12}>
          {model.attention.approvals.map((approval) => (
            <Card key={approval.id} size="small" type="inner" title="Нужно ваше согласие">
              <Typography.Paragraph>{approval.explanation}</Typography.Paragraph>
              <Space wrap>
                <Button type="primary" onClick={() => void decide(approval.id, true)} loading={busy === approval.id}>
                  Согласен
                </Button>
                <Button onClick={() => void decide(approval.id, false)} disabled={busy === approval.id}>
                  Не надо
                </Button>
              </Space>
            </Card>
          ))}
          {q ? (
            <Card size="small" type="inner" title="Сколько обращений стали клиентами?" data-testid="clients-question">
              <Typography.Paragraph>
                С {formatLocalDate(q.week)} по {formatLocalDate(q.weekEnd)} было обращений: {q.leads}. Сколько из них стали вашими клиентами?
              </Typography.Paragraph>
              <Space wrap>
                <InputNumber min={0} max={q.leads} value={clients} onChange={(v) => setClients(typeof v === "number" ? Math.round(v) : null)} aria-label="Сколько стали клиентами" />
                <Button type="primary" onClick={() => void answerClients(q.week)} disabled={clients === null} loading={busy === "clients"}>
                  Ответить
                </Button>
              </Space>
            </Card>
          ) : null}
          {model.attention.notifications.map((n) => (
            <Alert key={n.id} type="info" title={n.message} description={formatDateTime(n.at, model.timeZone)} />
          ))}
        </Flex>
      </Card>

      <Card title="Что я сделал за неделю" size="small">
        {model.actions.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Пока ничего не менял: рекламе нужно время, чтобы набрать данные" />
        ) : (
          <List
            dataSource={model.actions}
            renderItem={(action) => (
              <List.Item>
                <List.Item.Meta title={action.text} description={formatDateTime(action.at, model.timeZone)} />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Collapse
        items={[
          {
            key: "directions",
            label: "Подробнее по направлениям",
            children: (
              <List
                dataSource={model.directions}
                renderItem={(d) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space wrap>
                          {d.name}
                          <Tag>{channelLabel(d.channel)}</Tag>
                          {d.status === "paused" ? <Tag color="default">на паузе</Tag> : <Tag color="green">работает</Tag>}
                        </Space>
                      }
                      description={`Потрачено ${formatRub(d.spend)} · обращений ${d.leads}${d.costPerLead === null ? "" : ` · ${formatRub(d.costPerLead)} за обращение`}`}
                    />
                  </List.Item>
                )}
              />
            ),
          },
        ]}
      />
    </Flex>
  );
}
