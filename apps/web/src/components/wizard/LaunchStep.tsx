"use client";

import { ClockCircleOutlined, PhoneOutlined, RocketOutlined, SafetyCertificateOutlined, ShopOutlined, WalletOutlined } from "@ant-design/icons";
import { Alert, Button } from "antd";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import type { AccountMode } from "@/lib/account-mode";
import { PENDING_TEXT, runWebJob } from "@/lib/client-api";
import { launchStepWords } from "@/lib/launch-step";
import { advertisedText, budgetCeilingText, counterOf, GOAL_OPTIONS, hasOwnSite, hoursWords } from "@/lib/onboarding";
import type { OnboardingDraft } from "@/lib/onboarding";
import { measurementState } from "@/lib/measurement";
import { MeasurementNotice } from "../MeasurementNotice";
import { Note } from "../ui/primitives";
import { checkOnServer, CounterCheckBlock, GoalsStep } from "./GoalsStep";

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
  /** Opens the wizard step where this line of the summary is changed. */
  onEdit: (step: number) => void;
  /** What counts as a lead is changed right here, and the counter check writes its result into the draft. */
  onChange?: (draft: OnboardingDraft) => void;
  errors?: Record<string, string>;
  /** The account's mode (simulation-mode «Режим бизнеса «Симуляция»»): a demo launches on the training market. */
  mode: AccountMode;
  /** Saves the draft first, so the launch takes the ads and pictures as the owner sees them. */
  save?: () => Promise<boolean>;
}

export function LaunchStep({ draft, today, onEdit, mode, onChange, save, errors = {} }: Props) {
  const router = useRouter();
  const [goalsOpen, setGoalsOpen] = useState(errors.goals !== undefined);
  const [state, setState] = useState<{ kind: "idle" | "running" | "pending" | "advertiser_data" } | { kind: "error"; message: string }>({ kind: "idle" });
  const budget = draft.budget.monthlyBudgetRub ?? 0;
  const counter = counterOf(draft);
  const simulation = mode === "simulation";
  const words = launchStepWords(mode);

  const launch = async () => {
    setState({ kind: "running" });
    if (save !== undefined && !(await save())) {
      setState({ kind: "idle" });
      return;
    }
    // The server launches in the account's mode; the page does not ask for one.
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

  // Four lines, each changed on its own step; technical details stay in the settings (business-onboarding spec).
  const items: { icon: ReactNode; title: string; text: string; step: number | "goals" }[] = [
    { icon: <ShopOutlined />, title: "Что рекламируем", text: advertisedText(draft.card), step: 2 },
    { icon: <ClockCircleOutlined />, title: "Где и когда", text: `Город «${draft.card.city}», ${hoursWords(draft.card)}`, step: 2 },
    {
      icon: <WalletOutlined />,
      title: "Бюджет",
      // `today` is the launch day: in a simulation its own 1st of the month, which the owner never sees as a date.
      text: budgetCeilingText(budget, today),
      step: 2,
    },
    // Chosen in advance and changed in place: there is no step of its own (business-onboarding «Определение клиента»).
    { icon: <PhoneOutlined />, title: "Что считаем обращением", text: GOAL_OPTIONS.filter((g) => draft.goals.includes(g.value)).map((g) => g.label.toLowerCase()).join(", ") || "ничего не выбрано", step: "goals" },
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
            <button type="button" className="link-button" onClick={() => (item.step === "goals" ? setGoalsOpen(!goalsOpen) : onEdit(item.step))} aria-label={`${item.title}: изменить`} aria-expanded={item.step === "goals" ? goalsOpen : undefined}>
              изменить
            </button>
          </li>
        ))}
      </ul>
      {goalsOpen && onChange ? <GoalsStep draft={draft} onChange={onChange} errors={errors} counter={false} /> : null}
      {/* One notice about counting leads: the check itself for a real launch, the training data's note in a simulation. */}
      {!simulation && onChange && hasOwnSite(draft) ? <CounterCheckBlock draft={draft} onChange={onChange} check={checkOnServer} /> : <MeasurementNotice model={measurementState(counter, simulation)} />}
      {/* What happens after the button (business-onboarding spec «Что будет после запуска»). */}
      <Note icon={<SafetyCertificateOutlined aria-hidden="true" />} data-testid="after-launch">
        {words.afterLaunch}
      </Note>
      {state.kind === "error" ? <Alert type="error" showIcon title={state.message} /> : null}
      {state.kind === "advertiser_data" ? <AdvertiserDataNotice onDone={() => void launch()} /> : null}
      {state.kind === "pending" ? <Alert type="info" showIcon title={PENDING_TEXT} action={<Button onClick={() => router.push("/summary")}>Открыть рекламу</Button>} /> : null}
      <Button
        type="primary"
        size="large"
        block
        icon={<RocketOutlined aria-hidden="true" />}
        onClick={() => void launch()}
        loading={state.kind === "running"}
        disabled={state.kind === "pending"}
        style={{ height: 54, fontSize: "var(--fs-md)" }}
      >
        {words.button}
      </Button>
    </div>
  );
}
