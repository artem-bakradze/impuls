"use client";

import { InputNumber } from "antd";
import { monthBudget } from "@impuls/core";
import {
  budgetCeilingText,
  budgetLowWarning,
  budgetTooLowMessage,
  interimAutoGoalRub,
  leadsEstimateText,
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

/** Days left in the launch month as a strip: the first month is prorated (budget-guard spec). */
function MonthStrip({ today }: { today: string }) {
  const [y, m, d] = today.split("-").map(Number);
  const days = new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).getUTCDate();
  return (
    <div className="month-strip" aria-hidden="true">
      {Array.from({ length: days }, (_, i) => (
        <i key={i} data-on={i + 1 >= (d ?? 1)} />
      ))}
    </div>
  );
}

export function BudgetStep({ draft, onChange, today }: StepProps & { today: string }) {
  const budget = draft.budget;
  const set = (patch: Partial<typeof budget>) => onChange({ ...draft, budget: { ...budget, ...patch } });
  const amount = budget.monthlyBudgetRub;
  const valid = amount !== null && amount >= MIN_BUDGET_RUB;
  const prorated = valid && monthBudget(amount, today, today) < amount * 100;
  const leads = budget.goalMode === "user" && valid && budget.goalRub !== null ? Math.floor(amount / budget.goalRub) : null;

  return (
    <div className="stack" style={{ "--gap": "26px" } as React.CSSProperties}>
      <Field label="Сколько вы готовы тратить на рекламу в месяц" help="Сумма с НДС. Минимум — 3 000 ₽, рекомендуем от 10 000 ₽.">
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

      <Field label="Сколько вы готовы платить за одно обращение — заявку, звонок или сообщение?">
        {/* Pills wrap on narrow screens, unlike a segmented control. */}
        <div className="presets" role="radiogroup" aria-label="Как задать цену обращения">
          {(
            [
              { value: "user", label: "Укажу сумму" },
              { value: "auto", label: "Не знаю — подберите сами" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={budget.goalMode === option.value}
              aria-pressed={budget.goalMode === option.value}
              className="preset"
              onClick={() => set({ goalMode: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
        {budget.goalMode === "user" ? (
          <InputNumber<number>
            style={{ width: 200 }}
            min={1}
            step={50}
            value={budget.goalRub}
            onChange={(value) => set({ goalRub: typeof value === "number" && value > 0 ? Math.round(value) : null })}
            formatter={rubFormatter}
            parser={rubParser}
            suffix="₽"
            aria-label="Цена одного обращения"
          />
        ) : null}
      </Field>

      {valid ? (
        <div className="forecast fade-in">
          <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
            <span className="t-eyebrow" style={{ color: "rgba(255,255,255,0.75)" }}>
              Что получится
            </span>
            {leads !== null ? (
              <>
                <div className="big t-num">до {leads}</div>
                <div style={{ fontWeight: 600 }}>обращений в месяц</div>
                <div className="t-small" data-testid="leads-estimate">
                  {leadsEstimateText(amount, budget.goalRub ?? 0)}
                </div>
              </>
            ) : budget.goalMode === "auto" ? (
              <div style={{ fontWeight: 600, fontSize: 18 }} data-testid="auto-goal">
                Начнём с цены до {formatRub(interimAutoGoalRub(amount) * 100)} за обращение и уточним её по вашим результатам, когда наберётся 20 обращений.
              </div>
            ) : (
              <div style={{ fontWeight: 600, fontSize: 18 }}>Укажите цену обращения — посчитаем, сколько их получится.</div>
            )}
            <div className="t-small" style={{ marginTop: 6 }} data-testid="budget-ceiling">
              {budgetCeilingText(amount, today)}
            </div>
            {prorated ? <MonthStrip today={today} /> : null}
            <div className="t-small">Прогноз обращений появится после первой недели работы.</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
