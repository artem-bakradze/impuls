"use client";

import { Button, Drawer, InputNumber } from "antd";
import { useState } from "react";
import { runWebJob } from "@/lib/client-api";
import { formatLocalDate, plural } from "@/lib/format";
import type { SummaryModel } from "@/lib/summary-model";

/** The owner's one open task: how many of last week's leads became clients. Kept off the brief, one tap away. */
export function QuestionSheet({ question, onClose, onDone }: { question: NonNullable<SummaryModel["attention"]["clientsQuestion"]>; onClose: () => void; onDone: () => void }) {
  const [clients, setClients] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = async () => {
    if (clients === null) return;
    setBusy(true);
    setError(null);
    const outcome = await runWebJob("/api/clients", { week: question.week, clients });
    setBusy(false);
    if (outcome.kind === "done") {
      onDone();
      onClose();
    } else {
      setError(outcome.kind === "error" ? outcome.message : "Проверка ещё выполняется. Обновите страницу чуть позже.");
    }
  };
  return (
    <Drawer open onClose={onClose} closable={{ "aria-label": "Закрыть" }} placement="right" width="min(460px, 100vw)" title="Вопрос" className="sheet" styles={{ body: { padding: 0 } }}>
      <div className="sheet-body" data-testid="clients-question">
        <h2 className="sheet-title">Сколько клиентов?</h2>
        <p className="sheet-note">
          {formatLocalDate(question.week)} — {formatLocalDate(question.weekEnd)} · {question.leads} {plural(question.leads, "обращение", "обращения", "обращений")}
        </p>
        <div className="question-row">
          <InputNumber min={0} max={question.leads} value={clients} onChange={(v) => setClients(typeof v === "number" ? Math.round(v) : null)} aria-label="Сколько стали клиентами" />
          <Button type="primary" onClick={() => void answer()} disabled={clients === null} loading={busy}>
            Ответить
          </Button>
        </div>
        {error ? <p className="sheet-error" role="alert">{error}</p> : null}
      </div>
    </Drawer>
  );
}
