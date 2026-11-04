"use client";

import { InfoCircleOutlined } from "@ant-design/icons";
import { Popover } from "antd";
import type { ReactNode } from "react";
import { budgetPace } from "@/lib/budget-pace";
import { formatLocalDate, formatRub } from "@/lib/format";
import type { SummaryModel } from "@/lib/summary-model";

/** The numbers behind a result and one sentence on what they mean: what opens on a result chip. */
export function NumbersCard({ title, rows, note, testId }: { title: string; rows: [string, string][]; note: ReactNode; testId: string }) {
  return (
    <div className="numbers-card" data-testid={testId}>
      <p className="numbers-card-title">{title}</p>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="numbers-card-note">{note}</p>
    </div>
  );
}

/** A result in words, coloured by its tone, that opens its numbers by hover or tap. */
export function ResultChip({ result, numbers, testId }: { result: { tone: string; text: string }; numbers: ReactNode; testId: string }) {
  return (
    <Popover trigger={["hover", "click"]} placement="top" content={numbers}>
      <button type="button" className="result-chip" data-tone={result.tone} data-testid={testId}>
        {result.text}
        <InfoCircleOutlined aria-hidden="true" />
      </button>
    </Popover>
  );
}

/**
 * The month's money pace against the even plan in words, with the budget, the plan, what is spent and left on hover or
 * tap — one for the main screen (analytics spec «Сводка») and the studio (simulation-mode spec «Итог студии»). There is
 * no pace before the first data: nothing spent against the first day's plan says nothing.
 */
export function BudgetPaceChip({
  model,
  firstDay,
}: {
  model: Pick<SummaryModel, "monthBudget" | "spentMonth" | "budgetPlan" | "budgetForecast" | "dataPeriod">;
  firstDay: boolean;
}) {
  const today = model.dataPeriod?.to ?? "";
  const pace = firstDay ? null : budgetPace({ monthBudget: model.monthBudget, spent: model.spentMonth, plan: model.budgetPlan, forecast: model.budgetForecast, month: today.slice(0, 7) });
  if (pace === null) return null;
  const day = today === "" ? "сегодня" : formatLocalDate(today);
  const exhaustOn = model.budgetForecast?.exhaustOn ?? null;
  const rows: [string, string][] = [
    ["Бюджет месяца", formatRub(model.monthBudget)],
    [`План к ${day}`, formatRub(model.budgetPlan)],
    ["Потрачено", formatRub(model.spentMonth)],
    // Whole rubles of the budget less the whole rubles shown as spent, so the two lines add up to the budget on screen.
    ["Осталось", formatRub(Math.max(0, Math.floor(model.monthBudget / 100) - Math.floor(model.spentMonth / 100)) * 100)],
    ...(exhaustOn === null ? [] : ([["Хватит до", formatLocalDate(exhaustOn)]] as [string, string][])),
  ];
  const numbers = (
    <NumbersCard title={`К ${day}`} rows={rows} note={`План — сколько ушло бы к ${day}, если тратить бюджет месяца поровну каждый день.`} testId="budget-numbers" />
  );
  return <ResultChip result={pace} numbers={numbers} testId="budget-pace" />;
}
