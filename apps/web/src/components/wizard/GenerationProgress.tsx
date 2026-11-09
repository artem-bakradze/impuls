"use client";

import { CheckOutlined, EditOutlined, GlobalOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";

export type GenerationKind = "extract" | "generate";

/**
 * The 10–60 s wait while the worker reads pages or writes ads, shown as the work it is: stages that tick off and
 * skeletons of what is coming. Stage timing is approximate (the job reports no progress); the last stage stays
 * active until the result arrives.
 */
const STAGES: Record<GenerationKind, { title: string; lead: string; steps: string[]; everyMs: number }> = {
  extract: {
    title: "Читаем ваш сайт",
    lead: "Собираем карточку бизнеса: услуги, цены, адрес и часы работы. Обычно это 10–20 секунд.",
    steps: ["Открываем страницы", "Находим услуги и цены", "Собираем карточку"],
    everyMs: 4_000,
  },
  generate: {
    title: "Пишем объявления",
    lead: "Каждый текст проверяем на закон о рекламе и правила Яндекса. Обычно это занимает до минуты.",
    steps: ["Изучаем карточку", "Пишем объявления для поиска", "Пишем объявления для сайтов-партнёров", "Проверяем тексты на закон о рекламе", "Подбираем поисковые запросы"],
    everyMs: 7_000,
  },
};

export function GenerationProgress({ kind }: { kind: GenerationKind }) {
  const stage = STAGES[kind];
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setActive((current) => Math.min(current + 1, stage.steps.length - 1)), stage.everyMs);
    return () => clearInterval(timer);
  }, [stage]);

  return (
    <div className="surface gen fade-in" role="status" aria-live="polite" data-testid="wizard-busy">
      <div className="stack" style={{ "--gap": "22px" } as React.CSSProperties}>
        <div className="gen-head">
          <span className="gen-mark" aria-hidden="true">
            {kind === "extract" ? <GlobalOutlined /> : <EditOutlined />}
          </span>
          <div>
            <h2 className="t-h2">{stage.title}…</h2>
            <p className="t-small" style={{ marginTop: 4 }}>
              {stage.lead}
            </p>
          </div>
        </div>
        <div className="gen-bar" aria-hidden="true">
          <i style={{ width: `${Math.round(((active + 0.5) / stage.steps.length) * 100)}%` }} />
        </div>
        <ol className="gen-steps">
          {stage.steps.map((label, index) => (
            <li key={label} data-state={index < active ? "done" : index === active ? "active" : "todo"}>
              <span className="gen-dot">{index < active ? <CheckOutlined /> : null}</span>
              {label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
