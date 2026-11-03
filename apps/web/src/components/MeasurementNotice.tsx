"use client";

import { Button } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CounterCheck } from "@impuls/worker";
import { runWebJob } from "@/lib/client-api";
import { measurementState, measurementText } from "@/lib/measurement";
import type { MeasurementModel } from "@/lib/measurement";
import { Note } from "./ui/primitives";

export function MeasurementNotice({ model, compact = false, readOnly = false }: { model: MeasurementModel; compact?: boolean; readOnly?: boolean }) {
  const router = useRouter();
  const [check, setCheck] = useState<MeasurementModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = check ?? model;
  const text = measurementText(shown);
  const verify = async () => {
    setBusy(true); setError(null);
    const outcome = await runWebJob<CounterCheck>("/api/onboarding/counter", undefined);
    setBusy(false);
    if (outcome.kind === "done") { setCheck(measurementState(outcome.output)); router.refresh(); }
    else setError(outcome.kind === "error" ? outcome.message : "Проверка ещё выполняется. Обновите страницу чуть позже.");
  };
  if (compact && shown.simulated) return <details className="context-details" data-testid="measurement-status"><summary>Учебные данные</summary><p className="t-small">{text.detail}</p></details>;
  return <Note tone={shown.simulated || shown.status === "found" ? "neutral" : "warning"} data-testid="measurement-status">
    <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
      <strong>{text.title}</strong><span>{text.detail}</span>
      {readOnly && !shown.simulated ? <Link href="/settings#site">Настроить учёт обращений</Link> : !shown.simulated ? <><Button onClick={() => void verify()} loading={busy} style={{ alignSelf: "flex-start" }}>Проверить счётчик</Button><a href="https://metrika.yandex.ru/" target="_blank" rel="noreferrer">Открыть Метрику и проверить действия</a></> : null}
      {error ? <span role="alert">{error}</span> : null}
    </div>
  </Note>;
}
