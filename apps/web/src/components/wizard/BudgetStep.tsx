"use client";

import { Alert, Flex, InputNumber, Radio, Typography } from "antd";
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
import type { StepProps } from "./Wizard";

const rubFormatter = (value: number | string | undefined): string => (value === undefined || value === "" ? "" : `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, " "));
const rubParser = (value: string | undefined): number => Number((value ?? "").replace(/\D/g, ""));

export function BudgetStep({ draft, onChange, today }: StepProps & { today: string }) {
  const budget = draft.budget;
  const set = (patch: Partial<typeof budget>) => onChange({ ...draft, budget: { ...budget, ...patch } });
  const amount = budget.monthlyBudgetRub;
  const valid = amount !== null && amount >= MIN_BUDGET_RUB;

  return (
    <Flex vertical gap={16}>
      <div>
        <Typography.Text strong>Сколько вы готовы тратить на рекламу в месяц</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          Сумма с НДС. Минимум — 3 000 ₽, рекомендуем от 10 000 ₽.
        </Typography.Paragraph>
        <InputNumber<number>
          style={{ width: 200, marginTop: 8 }}
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
      </div>
      {amount !== null && amount < MIN_BUDGET_RUB ? <Alert type="error" showIcon title={budgetTooLowMessage} /> : null}
      {valid && amount < RECOMMENDED_BUDGET_RUB ? <Alert type="warning" showIcon title={budgetLowWarning} /> : null}
      {valid ? (
        <Alert type="success" showIcon title={budgetCeilingText(amount, today)} data-testid="budget-ceiling" />
      ) : null}
      {valid ? <Typography.Text type="secondary">Прогноз обращений появится после первой недели работы.</Typography.Text> : null}

      <div>
        <Typography.Text strong>Сколько вы готовы платить за одно обращение — заявку, звонок или сообщение?</Typography.Text>
        <Radio.Group
          style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}
          value={budget.goalMode}
          onChange={(e) => set({ goalMode: e.target.value as "user" | "auto" })}
          options={[
            { value: "user", label: "Укажу сумму" },
            { value: "auto", label: "Не знаю — подберите сами" },
          ]}
        />
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
      {budget.goalMode === "user" && valid && budget.goalRub !== null ? (
        <Typography.Text data-testid="leads-estimate">{leadsEstimateText(amount, budget.goalRub)}</Typography.Text>
      ) : null}
      {budget.goalMode === "auto" && valid ? (
        <Typography.Text data-testid="auto-goal">
          Начнём с цены до {formatRub(interimAutoGoalRub(amount) * 100)} за обращение и уточним её по вашим результатам, когда наберётся 20 обращений.
        </Typography.Text>
      ) : null}
    </Flex>
  );
}
