"use client";

import { ArrowLeftOutlined, CheckOutlined, ClockCircleOutlined, CloseOutlined, ScissorOutlined, SendOutlined } from "@ant-design/icons";
import { Collapse } from "antd";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/format";
import { plain } from "@/lib/service-work";
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
  applied: { text: "Сделано", tone: "success", icon: <CheckOutlined /> },
  clamped: { text: "Сделано в меньшем размере", tone: "warning", icon: <ScissorOutlined /> },
  queued: { text: "Отправлено вам на подтверждение", tone: "accent", icon: <SendOutlined /> },
  rejected: { text: "Сервис не дал это сделать", tone: "danger", icon: <CloseOutlined /> },
};

const DONE = /^(выполнено|применено)\.?$/i;

const TRIGGERS: Record<string, string> = {
  launch: "Запуск рекламы",
  daily_review: "Ежедневный разбор",
  weekly_review: "Разбор недели",
  moderation_rejected: "Отказ модерации",
  experiment_finished: "Итог проверки",
  settings_changed: "Изменение настроек",
};

/**
 * Agent turn journal (ad-agent spec) in plain words (change-history spec «Страница решения сервиса»): what the service
 * tried and what came of it; the executor, the instructions and the context stay behind «Для специалистов».
 */
export function TurnView({ turn, timeZone }: { turn: TurnViewModel; timeZone: string }) {
  return (
    <div className="page page-narrow">
      <Link href="/summary#history" style={{ fontSize: "var(--fs-sm)", fontWeight: 550, textDecoration: "none" }}>
        <ArrowLeftOutlined style={{ marginRight: 6 }} />К истории
      </Link>
      <div style={{ height: 16 }} />
      <PageHead title="Как сервис принял решение" lead="Перед каждым действием сервис сверяется с бюджетом месяца и своими правилами: то, что выходит за них, он урезает или не делает." />
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
          </div>
        </div>
        <h2 className="t-h2" style={{ marginTop: 8 }}>
          Что сервис пытался сделать и что получилось
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
                <p className="t-body">{plain(call.insight?.observation ?? call.justification?.text ?? "")}</p>
                {/* «Сделано» already says «выполнено»; the result line is for a cut, a refusal or a question. */}
                {DONE.test(call.result.message.trim()) ? null : <span className="t-small">Итог: {plain(call.result.message)}</span>}
              </div>
            </div>
          );
        })}
        <Collapse
          items={[
            {
              key: "context",
              label: "Для специалистов: данные, которые видел сервис",
              children: (
                <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
                  <span className="t-small" data-testid="turn-tech">
                    Исполнитель: {turn.runtime}, версия инструкций {turn.instructionsVersion}, статус хода: {turn.status}
                  </span>
                  <pre className="snippet">{JSON.stringify(turn.context, null, 2)}</pre>
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
