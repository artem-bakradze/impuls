"use client";

import { Alert, Button, Descriptions, Flex, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PENDING_TEXT, runWebJob } from "@/lib/client-api";
import { formatRub } from "@/lib/format";
import { budgetCeilingText, buildLaunchPlan, GOAL_OPTIONS, interimAutoGoalRub, scheduleText } from "@/lib/onboarding";
import type { OnboardingDraft } from "@/lib/onboarding";

interface Props {
  draft: OnboardingDraft;
  today: string;
  minWeeklyLimitRub: number;
}

export function LaunchStep({ draft, today, minWeeklyLimitRub }: Props) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: "idle" | "running" | "pending" } | { kind: "error"; message: string }>({ kind: "idle" });
  const plan = buildLaunchPlan(draft, today, minWeeklyLimitRub);
  const budget = draft.budget.monthlyBudgetRub ?? 0;
  const goal = draft.budget.goalMode === "user" ? `до ${formatRub((draft.budget.goalRub ?? 0) * 100)} за обращение` : `подбираем сами, начнём с ${formatRub(interimAutoGoalRub(budget) * 100)}`;

  const launch = async () => {
    setState({ kind: "running" });
    const outcome = await runWebJob<{ directionIds: string[] }>("/api/onboarding/launch", {});
    if (outcome.kind === "done") {
      router.push("/summary");
      router.refresh();
    } else if (outcome.kind === "pending") {
      setState({ kind: "pending" });
    } else {
      setState({ kind: "error", message: outcome.message });
    }
  };

  return (
    <Flex vertical gap={16}>
      <Descriptions
        column={1}
        size="small"
        items={[
          { key: "what", label: "Что рекламируем", children: `${draft.card.category}: ${draft.card.services.map((s) => s.name).filter(Boolean).join(", ")}` },
          { key: "where", label: "Где показываем", children: `до ${draft.card.radiusKm} км от адреса «${draft.card.address}»` },
          { key: "when", label: "Когда показываем", children: scheduleText(draft.card) },
          { key: "budget", label: "Бюджет", children: budgetCeilingText(budget, today) },
          { key: "goal", label: "Цена обращения", children: goal },
          { key: "leads", label: "Обращения", children: GOAL_OPTIONS.filter((g) => draft.goals.includes(g.value)).map((g) => g.label).join(", ") },
          {
            key: "ads",
            label: "Объявления",
            children: plan.directions.map((d) => `${d.channel === "search" ? "в поиске" : "на сайтах-партнёрах"}: ${d.ads.length}, до ${formatRub(d.weeklyLimitRub * 100)} в неделю`).join("; "),
          },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        После запуска Яндекс проверит объявления — обычно это занимает несколько часов. Всё, что мы будем менять, вы увидите в истории и сможете вернуть.
      </Typography.Paragraph>
      {state.kind === "error" ? <Alert type="error" showIcon title={state.message} /> : null}
      {state.kind === "pending" ? (
        <Alert type="info" showIcon title={PENDING_TEXT} action={<Button onClick={() => router.push("/summary")}>Открыть сводку</Button>} />
      ) : null}
      <Button type="primary" size="large" onClick={() => void launch()} loading={state.kind === "running"} disabled={state.kind === "pending"}>
        Запустить
      </Button>
    </Flex>
  );
}
