"use client";

import {
  AimOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  NotificationOutlined,
  PhoneOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { Alert, Button } from "antd";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { PENDING_TEXT, runWebJob } from "@/lib/client-api";
import { formatRub } from "@/lib/format";
import { budgetCeilingText, buildLaunchPlan, cityOf, GOAL_OPTIONS, interimAutoGoalRub, scheduleText } from "@/lib/onboarding";
import type { OnboardingDraft } from "@/lib/onboarding";
import { Note } from "../ui/primitives";

/** Shown when Direct refuses to start ads because the advertiser data for marking is missing. */
export function AdvertiserDataNotice({ onDone }: { onDone: () => void }) {
  return (
    <div className="note note-warning" data-testid="advertiser-data-notice">
      <div className="stack" style={{ "--gap": "10px" } as React.CSSProperties}>
        <strong>Яндексу нужны данные о вашем бизнесе для маркировки рекламы</strong>
        <span>
          По закону каждое объявление маркируется, поэтому Яндекс просит один раз указать, кто рекламодатель. Откройте{" "}
          <a href="https://direct.yandex.ru/" target="_blank" rel="noreferrer">
            Яндекс Директ
          </a>
          , заполните данные рекламодателя (название, ИНН) и вернитесь сюда.
        </span>
        <Button type="primary" onClick={onDone} style={{ alignSelf: "flex-start" }}>
          Готово
        </Button>
      </div>
    </div>
  );
}

interface Props {
  draft: OnboardingDraft;
  today: string;
  minWeeklyLimitRub: number;
}

export function LaunchStep({ draft, today, minWeeklyLimitRub }: Props) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: "idle" | "running" | "pending" | "advertiser_data" } | { kind: "error"; message: string }>({ kind: "idle" });
  const plan = buildLaunchPlan(draft, today, minWeeklyLimitRub);
  const budget = draft.budget.monthlyBudgetRub ?? 0;
  const goal = draft.budget.goalMode === "user" ? `до ${formatRub((draft.budget.goalRub ?? 0) * 100)} за обращение` : `подбираем сами, начнём с ${formatRub(interimAutoGoalRub(budget) * 100)}`;

  const launch = async () => {
    setState({ kind: "running" });
    const outcome = await runWebJob<{ status: "launched" | "needs_advertiser_data" }>("/api/onboarding/launch", {});
    if (outcome.kind === "done" && outcome.output.status === "needs_advertiser_data") {
      setState({ kind: "advertiser_data" });
    } else if (outcome.kind === "done") {
      router.push("/summary");
      router.refresh();
    } else if (outcome.kind === "pending") {
      setState({ kind: "pending" });
    } else {
      setState({ kind: "error", message: outcome.message });
    }
  };

  const items: { icon: ReactNode; title: string; text: string }[] = [
    { icon: <ShopOutlined />, title: "Что рекламируем", text: `${draft.card.category}: ${draft.card.services.map((s) => s.name).filter(Boolean).join(", ")}` },
    { icon: <EnvironmentOutlined />, title: "Где показываем", text: `Город «${cityOf(draft.card.address) || draft.card.address}», адрес «${draft.card.address}»` },
    { icon: <ClockCircleOutlined />, title: "Когда показываем", text: scheduleText(draft.card) },
    { icon: <WalletOutlined />, title: "Бюджет", text: budgetCeilingText(budget, today) },
    { icon: <AimOutlined />, title: "Цена обращения", text: goal },
    { icon: <PhoneOutlined />, title: "Что считаем обращением", text: GOAL_OPTIONS.filter((g) => draft.goals.includes(g.value)).map((g) => g.label).join(", ") },
    {
      icon: <NotificationOutlined />,
      title: "Объявления",
      text: plan.directions.map((d) => `${d.channel === "search" ? "в поиске" : "на сайтах-партнёрах"}: ${d.ads.length}, до ${formatRub(d.weeklyLimitRub * 100)} в неделю`).join("; "),
    },
  ];

  return (
    <div className="stack" style={{ "--gap": "18px" } as React.CSSProperties}>
      <ul className="checklist">
        {items.map((item) => (
          <li key={item.title}>
            <span className="check-icon">{item.icon}</span>
            <div className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
              <span className="t-small">{item.title}</span>
              <span className="t-body">{item.text}</span>
            </div>
          </li>
        ))}
      </ul>
      <Note icon={<SafetyCertificateOutlined aria-hidden="true" />}>Всё, что сервис будет менять, вы увидите в истории простыми словами и сможете вернуть одной кнопкой.</Note>
      {state.kind === "error" ? <Alert type="error" showIcon title={state.message} /> : null}
      {state.kind === "advertiser_data" ? <AdvertiserDataNotice onDone={() => void launch()} /> : null}
      {state.kind === "pending" ? <Alert type="info" showIcon title={PENDING_TEXT} action={<Button onClick={() => router.push("/summary")}>Открыть сводку</Button>} /> : null}
      <Button
        type="primary"
        size="large"
        block
        icon={<RocketOutlined aria-hidden="true" />}
        onClick={() => void launch()}
        loading={state.kind === "running"}
        disabled={state.kind === "pending"}
        style={{ height: 54, fontSize: 16 }}
      >
        Запустить
      </Button>
    </div>
  );
}
