"use client";

import { CompassOutlined, FormOutlined, MessageOutlined, PhoneOutlined } from "@ant-design/icons";
import { Checkbox, Collapse, Tabs } from "antd";
import type { ReactNode } from "react";
import { GOAL_OPTIONS, hasOwnSite } from "@/lib/onboarding";
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

export function GoalsStep({ draft, onChange }: StepProps) {
  const toggle = (value: string, checked: boolean) =>
    onChange({ ...draft, goals: checked ? [...draft.goals, value] : draft.goals.filter((g) => g !== value) });
  return (
    <div className="stack" style={{ "--gap": "20px" } as React.CSSProperties}>
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
      <span className="t-small">Можно выбрать несколько вариантов.</span>
      {hasOwnSite(draft) ? (
        <Collapse
          items={[
            {
              key: "metrika",
              label: "Как поставить на сайт счётчик Яндекс Метрики",
              children: (
                <div className="stack" style={{ "--gap": "12px" } as React.CSSProperties}>
                  <p className="t-body t-muted">
                    Счётчик — небольшой код, который замечает, что посетитель оставил заявку или нажал на телефон. Его номер появится после подключения Яндекса, а
                    поставить его можно так:
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
                  <Note tone="warning">Без счётчика обращения с сайта не будут посчитаны. Запустить рекламу это не мешает.</Note>
                </div>
              ),
            },
          ]}
        />
      ) : null}
    </div>
  );
}
