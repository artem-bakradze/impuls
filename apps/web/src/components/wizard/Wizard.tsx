"use client";

import { toLocalDate } from "@impuls/core";
import { Alert, Button, Card, Flex, Progress, Typography } from "antd";
import { useState } from "react";
import { callApi } from "@/lib/client-api";
import { draftAds, STEP_COUNT, stepProblems, WIZARD_STEPS } from "@/lib/onboarding";
import type { OnboardingDraft } from "@/lib/onboarding";
import { BudgetStep } from "./BudgetStep";
import { CardStep } from "./CardStep";
import { DirectStep } from "./DirectStep";
import { GoalsStep } from "./GoalsStep";
import { LaunchStep } from "./LaunchStep";
import { PreviewStep } from "./PreviewStep";
import { SourcesStep } from "./SourcesStep";

export interface WizardProps {
  initialDraft: OnboardingDraft;
  initialStep: number;
  directApiMode: "simulator" | "sandbox" | "production";
  minWeeklyLimitRub: number;
}

export interface StepProps {
  draft: OnboardingDraft;
  onChange: (draft: OnboardingDraft) => void;
}

export function Wizard({ initialDraft, initialStep, directApiMode, minWeeklyLimitRub }: WizardProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [step, setStep] = useState(initialStep);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems = stepProblems(step, draft);

  /** Progress is saved on every move so the owner can close the tab and continue later. */
  const goTo = async (target: number, next: OnboardingDraft) => {
    setSaving(true);
    setError(null);
    const result = await callApi<{ ok: true }>("/api/onboarding", "PUT", { step: target, draft: next });
    setSaving(false);
    if (result.kind === "error") {
      setError(result.message);
      return;
    }
    setDraft(next);
    setStep(target);
    window.scrollTo({ top: 0 });
  };

  const onNext = (override?: OnboardingDraft) => {
    let next = override ?? draft;
    if (step === 4 && next.ads === null) {
      next = { ...next, ads: draftAds(next) };
    }
    void goTo(step + 1, next);
  };

  const stepProps: StepProps = { draft, onChange: setDraft };

  return (
    <Flex vertical gap={16}>
      <div>
        <Typography.Text type="secondary" data-testid="wizard-step">
          Шаг {step} из {STEP_COUNT}
        </Typography.Text>
        <Progress percent={Math.round((step / STEP_COUNT) * 100)} showInfo={false} size="small" />
        <Typography.Title level={2} style={{ margin: "8px 0 0" }}>
          {WIZARD_STEPS[step - 1]}
        </Typography.Title>
      </div>
      <Card>
        {step === 1 ? <SourcesStep {...stepProps} /> : null}
        {step === 2 ? <CardStep {...stepProps} /> : null}
        {step === 3 ? <GoalsStep {...stepProps} /> : null}
        {step === 4 ? <BudgetStep {...stepProps} today={todayIn(draft.card.timeZone)} /> : null}
        {step === 5 ? <PreviewStep {...stepProps} /> : null}
        {step === 6 ? <DirectStep directApiMode={directApiMode} connected={draft.directConnected} onConnect={() => onNext({ ...draft, directConnected: true })} /> : null}
        {step === 7 ? <LaunchStep draft={draft} today={todayIn(draft.card.timeZone)} minWeeklyLimitRub={minWeeklyLimitRub} /> : null}
      </Card>
      {error ? <Alert type="error" showIcon title={error} /> : null}
      {step < STEP_COUNT && problems.length > 0 ? (
        <Alert type="info" showIcon title="Чтобы перейти дальше" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>} data-testid="step-hint" />
      ) : null}
      <Flex gap={8} justify="space-between">
        {step > 1 ? (
          <Button size="large" onClick={() => void goTo(step - 1, draft)} disabled={saving}>
            Назад
          </Button>
        ) : (
          <span />
        )}
        {step < STEP_COUNT && !(step === 6 && !draft.directConnected) ? (
          <Button type="primary" size="large" onClick={() => onNext()} disabled={problems.length > 0} loading={saving}>
            Дальше
          </Button>
        ) : null}
      </Flex>
    </Flex>
  );
}

const todayIn = (timeZone: string): string => toLocalDate(new Date(), timeZone);
