"use client";

import { InputNumber } from "antd";
import {
  budgetLowWarning,
  budgetPlan,
  budgetTooLowMessage,
  GOAL_MAX_RUB,
  GOAL_MIN_RUB,
  goalExplanation,
  MIN_BUDGET_RUB,
  RECOMMENDED_BUDGET_RUB,
} from "@/lib/onboarding";
import { formatRub } from "@/lib/format";
import { Note } from "../ui/primitives";
import { Field } from "./Field";
import type { StepProps } from "./Wizard";

const rubFormatter = (value: number | string | undefined): string => (value === undefined || value === "" ? "" : `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, " "));
const rubParser = (value: string | undefined): number => Number((value ?? "").replace(/\D/g, ""));

const PRESETS = [10_000, 15_000, 30_000, 50_000];

/** The same choice as in the settings (campaign-settings «Бюджет и цель»). */
const GOAL_MODES = [
  { value: "auto", label: "Подбирайте сами" },
  { value: "user", label: "Укажу сумму" },
] as const;

export function BudgetStep({ draft, onChange, today, errors = {} }: StepProps & { today: string }) {
  const budget = draft.budget;
  const set = (patch: Partial<typeof budget>) => onChange({ ...draft, budget: { ...budget, ...patch } });
  const amount = budget.monthlyBudgetRub;
  const valid = amount !== null && amount >= MIN_BUDGET_RUB;
  const plan = valid ? budgetPlan(amount, today) : null;

  return (
    <div className="stack" style={{ "--gap": "26px" } as React.CSSProperties}>
      <Field id="budget" label="Сколько вы готовы тратить на рекламу в месяц" error={errors.budget} help="Сумма с НДС. Минимум — 3 000 ₽, рекомендуем от 10 000 ₽.">
        <InputNumber<number>
          className="money-input"
          style={{ width: "100%", maxWidth: 320 }}
          size="large"
          min={1}
          step={1000}
          value={amount}
          onChange={(value) => set({ monthlyBudgetRub: typeof value === "number" && value > 0 ? Math.round(value) : null })}
          formatter={rubFormatter}
          parser={rubParser}
          suffix="₽"
          aria-label="Бюджет в месяц"
        />
        <div className="presets">
          {PRESETS.map((preset) => (
            <button key={preset} type="button" className="preset" aria-pressed={amount === preset} onClick={() => set({ monthlyBudgetRub: preset })}>
              {formatRub(preset * 100)}
            </button>
          ))}
        </div>
      </Field>
      {amount !== null && amount < MIN_BUDGET_RUB ? <Note tone="warning">{budgetTooLowMessage}</Note> : null}
      {valid && amount < RECOMMENDED_BUDGET_RUB ? <Note tone="warning">{budgetLowWarning}</Note> : null}


      {plan ? (
        <div className="forecast fade-in">
          <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
            <span className="t-eyebrow">
              Сколько потратим
            </span>
            <div style={{ fontWeight: 650, fontSize: "var(--fs-lg)" }} data-testid="budget-ceiling">
              {plan.headline}
            </div>
            {plan.detail ? <div className="t-small">{plan.detail}</div> : null}
          </div>
        </div>
      ) : null}

      {/* Optional: «Подбирайте сами» is chosen in advance (business-onboarding «Выбор бюджета»). */}
      <Field id="goal" label="Сколько готовы платить за одно обращение" error={errors.goal} help={<span data-testid="auto-goal">{goalExplanation(budget)}</span>}>
        <div className="presets" role="radiogroup" aria-label="Цена обращения">
          {GOAL_MODES.map((option) => (
            <button key={option.value} type="button" role="radio" aria-checked={budget.goalMode === option.value} aria-pressed={budget.goalMode === option.value} className="preset" onClick={() => set({ goalMode: option.value })}>
              {option.label}
            </button>
          ))}
        </div>
        {budget.goalMode === "user" ? (
          <InputNumber<number>
            className="money-input"
            style={{ width: "100%", maxWidth: 220 }}
            size="large"
            min={GOAL_MIN_RUB}
            max={GOAL_MAX_RUB}
            step={50}
            value={budget.goalRub}
            onChange={(value) => set({ goalRub: typeof value === "number" && value >= GOAL_MIN_RUB ? Math.min(Math.round(value), GOAL_MAX_RUB) : null })}
            formatter={rubFormatter}
            parser={rubParser}
            prefix="до"
            suffix="₽"
            aria-label="Цена одного обращения"
          />
        ) : null}
      </Field>
    </div>
  );
}
