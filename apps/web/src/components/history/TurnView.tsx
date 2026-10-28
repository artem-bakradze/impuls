"use client";

import { Card, Collapse, Flex, Tag, Typography } from "antd";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";

export interface TurnViewModel {
  trigger: string;
  runtime: string;
  instructionsVersion: string;
  status: string;
  startedAt: string;
  context: unknown;
  calls: { justification: { text: string }; result: { status: string; message: string } }[];
}

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  applied: { text: "Выполнено", color: "green" },
  clamped: { text: "Урезано ограничителем", color: "orange" },
  queued: { text: "Отправлено вам на подтверждение", color: "blue" },
  rejected: { text: "Отклонено ограничителем", color: "red" },
};

const TRIGGERS: Record<string, string> = {
  launch: "Запуск рекламы",
  daily_review: "Ежедневный разбор",
  moderation_rejected: "Отказ модерации",
  experiment_finished: "Итог проверки",
  settings_changed: "Изменение настроек",
};

/** Agent turn journal (ad-agent spec): context, tool calls and guard verdicts behind a history entry. */
export function TurnView({ turn, timeZone }: { turn: TurnViewModel; timeZone: string }) {
  return (
    <Flex vertical gap={16}>
      <Link href="/history">← К истории</Link>
      <Typography.Title level={2}>Как сервис принял решение</Typography.Title>
      <Card size="small" data-testid="turn-summary">
        <Flex vertical gap={4}>
          <Typography.Text>
            <b>Повод:</b> {TRIGGERS[turn.trigger] ?? turn.trigger}
          </Typography.Text>
          <Typography.Text>
            <b>Начало:</b> {formatDateTime(turn.startedAt, timeZone)}
          </Typography.Text>
          <Typography.Text type="secondary">
            Исполнитель: {turn.runtime}, версия инструкций {turn.instructionsVersion}, статус хода: {turn.status}
          </Typography.Text>
        </Flex>
      </Card>
      <Typography.Title level={4}>Действия и ответы ограничителей</Typography.Title>
      {turn.calls.length === 0 ? <Typography.Text type="secondary">В этом ходе сервис ничего не менял</Typography.Text> : null}
      {turn.calls.map((call, index) => {
        const label = STATUS_LABELS[call.result.status] ?? { text: call.result.status, color: "default" };
        return (
          <Card key={index} size="small" data-testid="turn-call">
            <Flex vertical gap={4}>
              <Tag color={label.color}>{label.text}</Tag>
              <Typography.Text>{call.justification.text}</Typography.Text>
              <Typography.Text type="secondary">Ответ: {call.result.message}</Typography.Text>
            </Flex>
          </Card>
        );
      })}
      <Collapse
        items={[
          {
            key: "context",
            label: "Для специалистов: данные, которые видел сервис",
            children: <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>{JSON.stringify(turn.context, null, 2)}</pre>,
          },
        ]}
      />
    </Flex>
  );
}
