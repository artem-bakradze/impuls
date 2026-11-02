"use client";

import { InputNumber } from "antd";
import {
  budgetLowWarning,
  budgetPlan,
  budgetTooLowMessage,
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
            <span className="t-eyebrow" style={{ color: "rgba(255,255,255,0.75)" }}>
              Сколько потратим
            </span>
            <div style={{ fontWeight: 650, fontSize: 22 }} data-testid="budget-ceiling">
              {plan.headline}
            </div>
            {plan.detail ? <div className="t-small">{plan.detail}</div> : null}
            <hr className="forecast-divider" />
            <div className="t-small" data-testid="auto-goal">
              Сколько будут стоить обращения, станет видно после первой недели работы. Дальше мы сами отключаем рекламу, которая приводит людей
              дороже, и добавляем денег той, что дешевле.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
