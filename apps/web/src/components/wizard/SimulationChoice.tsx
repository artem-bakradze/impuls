"use client";

import { DownOutlined, ExperimentOutlined, RocketOutlined, UpOutlined } from "@ant-design/icons";
import { Radio } from "antd";
import { useState } from "react";
import { RECOMMENDED_SCENARIO, SCENARIO_IDS, SCENARIOS, scenarioUnavailable } from "@impuls/worker/scenarios";
import type { ScenarioId } from "@impuls/worker/scenarios";
import type { OnboardingDraft } from "@/lib/onboarding";

export type LaunchMode = "direct" | "simulation";

/** Step 6: real ads in the owner's Direct account, or the same service on a simulated market (simulation-mode spec). */
export function ModeChoice({ mode, onChange }: { mode: LaunchMode; onChange: (mode: LaunchMode) => void }) {
  const options: { value: LaunchMode; icon: React.ReactNode; title: string; text: string }[] = [
    { value: "direct", icon: <RocketOutlined />, title: "Настоящая реклама в Яндекс Директе", text: "Объявления увидят люди, деньги списываются с баланса вашего Директа." },
    {
      value: "simulation",
      icon: <ExperimentOutlined />,
      title: "Симуляция",
      text: "Без денег и без Директа: месяц рекламы проходит по дням, и после каждого видно, что сервис заметил и решил.",
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

const adsOf = (draft: OnboardingDraft) => ({ search: draft.ads?.search.length ?? 0, network: draft.ads?.network.length ?? 0 });

/** Why a scenario cannot run with this draft, or null. */
const reasonFor = (draft: OnboardingDraft, id: ScenarioId): string | null => scenarioUnavailable(SCENARIOS[id], adsOf(draft), draft.budget.monthlyBudgetRub ?? 0);

/** The scenario step 6 selects in advance: the recommended one, or the first that fits the plan and the budget. */
export const defaultScenario = (draft: OnboardingDraft): ScenarioId | null =>
  [RECOMMENDED_SCENARIO, ...SCENARIO_IDS].find((id) => reasonFor(draft, id) === null) ?? null;

function ScenarioOption({ id, draft, checked, onChange, onEdit }: { id: ScenarioId; draft: OnboardingDraft; checked: boolean; onChange: (id: ScenarioId) => void; onEdit: (step: number) => void }) {
  const item = SCENARIOS[id];
  const reason = reasonFor(draft, id);
  // Missing ads are added on «Как увидят ваши объявления», a small budget is raised on «Бюджет».
  const fix = reason === null ? null : reason.startsWith("Нужно хотя бы") ? { step: 3, label: "Добавить объявление" } : { step: 2, label: "Изменить бюджет" };
  return (
    <label className="choice" data-checked={checked} aria-disabled={reason !== null} style={reason ? { opacity: 0.75, cursor: "not-allowed" } : undefined}>
      <Radio checked={checked} disabled={reason !== null} onChange={() => onChange(id)} aria-label={item.title} />
      <span className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
        <span style={{ fontWeight: 600 }}>
          {item.title}
          {item.recommended ? <span className="chip chip-accent chip-plain" style={{ marginLeft: 8 }}>рекомендуем</span> : null}
        </span>
        <span className="t-small">{reason ?? item.description}</span>
        {fix ? (
          <button type="button" className="link-button" style={{ alignSelf: "flex-start" }} onClick={() => onEdit(fix.step)}>
            {fix.label}
          </button>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Market scenarios (business-onboarding spec «Превью и запуск»): the recommended one first and selected in advance,
 * the others under «Другие сценарии»; one the plan or the budget does not fit is shown with the reason and the step
 * that fixes it.
 */
export function ScenarioPicker({
  draft,
  scenario,
  onChange,
  onEdit,
}: {
  draft: OnboardingDraft;
  scenario: ScenarioId | null;
  onChange: (scenario: ScenarioId) => void;
  onEdit: (step: number) => void;
}) {
  const first = defaultScenario(draft) ?? RECOMMENDED_SCENARIO;
  const others = SCENARIO_IDS.filter((id) => id !== first);
  const [open, setOpen] = useState(scenario !== null && scenario !== first);
  return (
    <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties} data-testid="scenarios">
      <span className="t-small">Как поведёт себя рынок:</span>
      <div className="choice-grid" role="radiogroup" aria-label="Сценарий симуляции">
        <ScenarioOption id={first} draft={draft} checked={scenario === first} onChange={onChange} onEdit={onEdit} />
        {open ? others.map((id) => <ScenarioOption key={id} id={id} draft={draft} checked={scenario === id} onChange={onChange} onEdit={onEdit} />) : null}
      </div>
      <button type="button" className="link-button" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <UpOutlined aria-hidden="true" /> : <DownOutlined aria-hidden="true" />} {open ? "Скрыть другие сценарии" : `Другие сценарии (${others.length})`}
      </button>
    </div>
  );
}
