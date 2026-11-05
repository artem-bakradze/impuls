"use client";

import { ExperimentOutlined, RocketOutlined } from "@ant-design/icons";
import { Radio } from "antd";

export type LaunchMode = "direct" | "simulation";

/** Step 3: real ads in the owner's Direct account, or the same service on the owner's own numbers (simulation-mode spec). */
export function ModeChoice({ mode, onChange }: { mode: LaunchMode; onChange: (mode: LaunchMode) => void }) {
  const options: { value: LaunchMode; icon: React.ReactNode; title: string; text: string }[] = [
    { value: "direct", icon: <RocketOutlined />, title: "Настоящая реклама в Яндекс Директе", text: "Объявления увидят люди, деньги списываются с баланса вашего Директа." },
    {
      value: "simulation",
      icon: <ExperimentOutlined />,
      title: "Симуляция",
      text: "Без денег и без Директа: цифры рекламы задаёте вы сами, а сервис разбирает их как отчёт Директа и решает, как в настоящей рекламе.",
    },
  ];
  return (
    <div className="choice-grid" role="radiogroup" aria-label="Как запускаем">
      {options.map((option) => (
        <label key={option.value} className="choice" data-checked={mode === option.value}>
          <Radio checked={mode === option.value} onChange={() => onChange(option.value)} aria-label={option.title} />
          <span className="row" style={{ "--gap": "14px", flexWrap: "nowrap" } as React.CSSProperties}>
            <span className="choice-icon" aria-hidden="true">
              {option.icon}
            </span>
            <span className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
              <span style={{ fontWeight: 600 }}>{option.title}</span>
              <span className="t-small">{option.text}</span>
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}
