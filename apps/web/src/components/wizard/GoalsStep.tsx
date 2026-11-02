"use client";

import { CheckCircleFilled, CompassOutlined, FormOutlined, MessageOutlined, PhoneOutlined, ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Checkbox, Collapse, Tabs } from "antd";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { CounterCheck } from "@impuls/worker";
import { runWebJob } from "@/lib/client-api";
import type { JobOutcome } from "@/lib/client-api";
import { COUNTER_MISSING_WARNING, counterOf, GOAL_OPTIONS, hasOwnSite, withCounter } from "@/lib/onboarding";
import { Note } from "../ui/primitives";
import type { StepProps } from "./Wizard";

const ICONS: Record<(typeof GOAL_OPTIONS)[number]["value"], ReactNode> = {
  form: <FormOutlined />,
  call: <PhoneOutlined />,
  messenger: <MessageOutlined />,
  route: <CompassOutlined />,
};

const HINTS: Record<(typeof GOAL_OPTIONS)[number]["value"], string> = {
  form: "Человек отправил форму на сайте",
  call: "Нажал на номер телефона",
  messenger: "Написал вам в мессенджер",
  route: "Построил маршрут до вас в Картах",
};

const BUILDER_STEPS: { key: string; label: string; steps: string[] }[] = [
  { key: "tilda", label: "Tilda", steps: ["Откройте «Настройки сайта» → «Аналитика».", "В поле «Яндекс Метрика» вставьте номер счётчика.", "Нажмите «Сохранить» и переопубликуйте все страницы."] },
  { key: "wix", label: "Wix", steps: ["Откройте «Настройки» → «Пользовательский код».", "Нажмите «Добавить код», вставьте код в раздел «Head», выберите «Все страницы».", "Сохраните и опубликуйте сайт."] },
  { key: "wordpress", label: "WordPress", steps: ["Установите плагин «Яндекс Метрика» или откройте «Внешний вид» → «Редактор тем».", "Вставьте код перед закрывающим тегом </head> в файле header.php или укажите номер счётчика в плагине.", "Сохраните изменения."] },
  { key: "taplink", label: "Taplink", steps: ["Откройте «Настройки» → «Статистика».", "В поле «Яндекс Метрика» вставьте номер счётчика.", "Сохраните изменения."] },
];

const checkOnServer = (): Promise<JobOutcome<CounterCheck>> => runWebJob<CounterCheck>("/api/onboarding/counter", undefined);

function CounterHowTo() {
  return (
    <Collapse
      items={[
        {
          key: "metrika",
          label: "Как поставить счётчик на сайт",
          children: (
            <div className="stack" style={{ "--gap": "12px" } as React.CSSProperties}>
              <p className="t-body t-muted">
                Счётчик — небольшой код, который замечает, что посетитель оставил заявку или нажал на телефон. Создайте его в{" "}
                <a href="https://metrika.yandex.ru/add" target="_blank" rel="noreferrer">
                  Яндекс Метрике
                </a>{" "}
                (бесплатно, тем же аккаунтом Яндекса), а потом поставьте на сайт:
              </p>
              <Tabs
                items={BUILDER_STEPS.map((builder) => ({
                  key: builder.key,
                  label: builder.label,
                  children: (
                    <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                      {builder.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  ),
                }))}
              />
            </div>
          ),
        },
      ]}
    />
  );
}

/** Metrica counter on the owner's site: checked when the step opens and again on request (analytics spec). */
function CounterCheckBlock({ draft, onChange, check }: StepProps & { check: () => Promise<JobOutcome<CounterCheck>> }) {
  const saved = counterOf(draft);
  const [checking, setChecking] = useState(saved === null);
  const [failed, setFailed] = useState<string | null>(null);
  const latest = useRef(draft);
  latest.current = draft;
  /** A result that arrives after the owner left the step must not overwrite the draft of a later step. */
  const alive = useRef(true);

  const run = async () => {
    setChecking(true);
    setFailed(null);
    const outcome = await check();
    if (!alive.current) return;
    setChecking(false);
    if (outcome.kind === "done") {
      onChange(withCounter(latest.current, outcome.output));
    } else {
      setFailed(outcome.kind === "error" ? outcome.message : "Проверка заняла слишком много времени");
    }
  };

  // Runs once when the step opens without a result for this site; the ref also guards React's double effect in dev.
  const started = useRef(false);
  useEffect(() => {
    alive.current = true;
    if (saved === null && !started.current) {
      started.current = true;
      void run();
    }
    return () => {
      alive.current = false;
    };
  }, []);

  const again = (
    <Button size="small" icon={<ReloadOutlined aria-hidden="true" />} onClick={() => void run()} loading={checking}>
      Проверить ещё раз
    </Button>
  );

  if (checking && saved === null) {
    return (
      <Note data-testid="counter-check">
        <span className="t-body">Проверяем, есть ли на сайте счётчик Яндекс Метрики…</span>
      </Note>
    );
  }
  if (saved?.status === "found") {
    return (
      <Note tone="success" icon={<CheckCircleFilled aria-hidden="true" />} data-testid="counter-check">
        <span className="t-body">
          Счётчик Метрики на сайте есть{saved.counterId === null ? "" : ` · № ${saved.counterId}`}. По нему будем считать обращения с сайта.
        </span>
      </Note>
    );
  }
  return (
    <div className="stack" style={{ "--gap": "12px" } as React.CSSProperties}>
      <Note tone="warning" icon={<WarningOutlined aria-hidden="true" />} data-testid="counter-check">
        <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
          <strong>{saved?.status === "not_found" ? "Счётчик Метрики на сайте не нашли" : "Не получилось открыть сайт, чтобы проверить счётчик"}</strong>
          <span>{failed ?? COUNTER_MISSING_WARNING}</span>
          <span style={{ alignSelf: "flex-start" }}>{again}</span>
        </div>
      </Note>
      <CounterHowTo />
    </div>
  );
}

export function GoalsStep({ draft, onChange, errors = {}, checkCounter = checkOnServer }: StepProps & { checkCounter?: () => Promise<JobOutcome<CounterCheck>> }) {
  const toggle = (value: string, checked: boolean) =>
    onChange({ ...draft, goals: checked ? [...draft.goals, value] : draft.goals.filter((g) => g !== value) });
  return (
    <div className="stack" style={{ "--gap": "20px" } as React.CSSProperties}>
      <div id="field-goals" className={errors.goals ? "field-invalid" : undefined}>
        <div className="choice-grid" role="group" aria-label="Что считать обращением">
          {GOAL_OPTIONS.map((goal) => {
            const checked = draft.goals.includes(goal.value);
            return (
              <Checkbox key={goal.value} className="choice" data-checked={checked} checked={checked} onChange={(e) => toggle(goal.value, e.target.checked)}>
                <span className="row" style={{ "--gap": "14px", flexWrap: "nowrap" } as React.CSSProperties}>
                  <span className="choice-icon" aria-hidden="true">
                    {ICONS[goal.value]}
                  </span>
                  <span className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
                    <span style={{ fontWeight: 600 }}>{goal.label}</span>
                    <span className="t-small">{HINTS[goal.value]}</span>
                  </span>
                </span>
              </Checkbox>
            );
          })}
        </div>
      </div>
      {errors.goals ? (
        <div className="field-error" role="alert">
          {errors.goals}
        </div>
      ) : (
        <span className="t-small">Можно выбрать несколько вариантов.</span>
      )}
      {hasOwnSite(draft) ? <CounterCheckBlock draft={draft} onChange={onChange} check={checkCounter} /> : null}
    </div>
  );
}
