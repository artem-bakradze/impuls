"use client";

import { ArrowLeftOutlined, CheckOutlined, ClockCircleOutlined, CloseOutlined, ScissorOutlined, SendOutlined } from "@ant-design/icons";
import { Collapse } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/format";
import { Chip, PageHead } from "../ui/primitives";
import type { Tone } from "../ui/primitives";

export interface TurnViewModel {
  trigger: string;
  runtime: string;
  instructionsVersion: string;
  status: string;
  startedAt: string;
  context: unknown;
  /** Turns before add-agent-insights carried a `justification` instead of the insight. */
  calls: { insight?: { observation: string }; justification?: { text: string }; result: { status: string; message: string } }[];
}

const STATUS_LABELS: Record<string, { text: string; tone: Tone; icon: ReactNode }> = {
  applied: { text: "Выполнено", tone: "success", icon: <CheckOutlined /> },
  clamped: { text: "Урезано ограничителем", tone: "warning", icon: <ScissorOutlined /> },
  queued: { text: "Отправлено вам на подтверждение", tone: "accent", icon: <SendOutlined /> },
  rejected: { text: "Отклонено ограничителем", tone: "danger", icon: <CloseOutlined /> },
};

const TRIGGERS: Record<string, string> = {
  launch: "Запуск рекламы",
  daily_review: "Ежедневный разбор",
  weekly_review: "Разбор недели",
  moderation_rejected: "Отказ модерации",
  experiment_finished: "Итог проверки",
  settings_changed: "Изменение настроек",
};

/** Agent turn journal (ad-agent spec): context, tool calls and guard verdicts behind a history entry. */
export function TurnView({ turn, timeZone }: { turn: TurnViewModel; timeZone: string }) {
  return (
    <div className="page page-narrow">
      <Link href="/history" style={{ fontSize: 14, fontWeight: 550, textDecoration: "none" }}>
        <ArrowLeftOutlined style={{ marginRight: 6 }} />К истории
      </Link>
      <div style={{ height: 16 }} />
      <PageHead title="Как сервис принял решение" lead="Каждое действие сервиса проходит через ограничители: они урезают или отклоняют всё, что противоречит вашему бюджету и правилам." />
      <div className="stack" style={{ "--gap": "14px" } as React.CSSProperties}>
        <div className="surface surface-pad" data-testid="turn-summary">
          <div className="stack" style={{ "--gap": "6px" } as React.CSSProperties}>
            <div className="row" style={{ "--gap": "10px" } as React.CSSProperties}>
              <span className="icon-tile accent">
                <ClockCircleOutlined />
              </span>
              <span className="t-h3">{TRIGGERS[turn.trigger] ?? turn.trigger}</span>
              <span className="spacer" />
              <span className="t-small">{formatDateTime(turn.startedAt, timeZone)}</span>
            </div>
            <span className="t-small">
              Исполнитель: {turn.runtime}, версия инструкций {turn.instructionsVersion}, статус хода: {turn.status}
            </span>
          </div>
        </div>
        <h2 className="t-h2" style={{ marginTop: 8 }}>
          Действия и ответы ограничителей
        </h2>
        {turn.calls.length === 0 ? <span className="t-small">В этом ходе сервис ничего не менял</span> : null}
        {turn.calls.map((call, index) => {
          const label = STATUS_LABELS[call.result.status] ?? { text: call.result.status, tone: "neutral" as Tone, icon: null };
          return (
            <div key={index} className="surface feed-card" data-testid="turn-call">
              <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
                <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                  <Chip tone={label.tone}>{label.text}</Chip>
                </div>
                <p className="t-body">{call.insight?.observation ?? call.justification?.text ?? ""}</p>
                <span className="t-small">Ответ: {call.result.message}</span>
              </div>
            </div>
          );
        })}
        <Collapse
          items={[
            {
              key: "context",
              label: "Для специалистов: данные, которые видел сервис",
              children: <pre className="snippet">{JSON.stringify(turn.context, null, 2)}</pre>,
            },
          ]}
        />
      </div>
    </div>
  );
}
