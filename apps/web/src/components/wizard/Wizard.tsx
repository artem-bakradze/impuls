"use client";

import { toLocalDate } from "@impuls/core";
import { Alert, Button, Card, Flex, Progress, Typography } from "antd";
import { useState } from "react";
import type { Creatives, ExtractCardResult } from "@impuls/worker";
import { callApi, LLM_POLL_ATTEMPTS, runWebJob } from "@/lib/client-api";
import { mergeExtractedCard, STEP_COUNT, stepProblems, WIZARD_STEPS } from "@/lib/onboarding";
import type { DirectOAuthOutcome } from "@/lib/direct-oauth";
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
  directApiMode: "simulator" | "production";
  /** Result of the Yandex OAuth redirect back to the wizard, if any. */
  directOutcome: DirectOAuthOutcome | null;
  minWeeklyLimitRub: number;
}

export interface StepProps {
  draft: OnboardingDraft;
  onChange: (draft: OnboardingDraft) => void;
}

export function Wizard({ initialDraft, initialStep, directApiMode, directOutcome, minWeeklyLimitRub }: WizardProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [step, setStep] = useState(initialStep);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the worker is doing right now (reading pages, writing ads); blocks the buttons. */
  const [busy, setBusy] = useState<string | null>(null);
  /** Shown on the card step when a page could not be read. */
  const [notice, setNotice] = useState<string | null>(null);

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

  /** Saves the current step without moving, so the worker reads what the owner sees. */
  const saveHere = async (current: OnboardingDraft): Promise<boolean> => {
    const result = await callApi<{ ok: true }>("/api/onboarding", "PUT", { step, draft: current });
    if (result.kind === "error") {
      setError(result.message);
      return false;
    }
    return true;
  };

  /** «Где вас найти?» → the worker reads the pages; what it found fills the card, the rest stays «Не нашли». */
  const extractCard = async () => {
    setError(null);
    setBusy("Читаем ваш сайт и собираем карточку бизнеса…");
    if (!(await saveHere(draft))) {
      setBusy(null);
      return;
    }
    const outcome = await runWebJob<ExtractCardResult>("/api/onboarding/extract", undefined, LLM_POLL_ATTEMPTS);
    setBusy(null);
    let next = draft;
    if (outcome.kind === "done") {
      next = mergeExtractedCard(draft, outcome.output.card);
      const names = { site: "сайт", maps: "Яндекс Карты", vk: "ВКонтакте" } as const;
      setNotice(outcome.output.unreadable.length > 0 ? `Не получилось прочитать: ${outcome.output.unreadable.map((u) => names[u]).join(", ")}. Проверьте и дополните карточку.` : null);
    } else {
      setNotice(outcome.kind === "error" ? outcome.message : "Читаем страницу дольше обычного — заполните карточку сами, это быстро.");
    }
    void goTo(2, next);
  };

  /** Ads and phrases from the confirmed card; on failure the owner stays on the step and can try again. */
  const generateCreatives = async (current: OnboardingDraft): Promise<OnboardingDraft | null> => {
    setError(null);
    setBusy("Пишем объявления по вашей карточке… Обычно это занимает до минуты.");
    if (!(await saveHere(current))) {
      setBusy(null);
      return null;
    }
    const outcome = await runWebJob<Creatives>("/api/onboarding/creatives", undefined, LLM_POLL_ATTEMPTS);
    setBusy(null);
    if (outcome.kind !== "done") {
      setError(outcome.kind === "error" ? outcome.message : "Объявления готовятся дольше обычного. Нажмите кнопку ещё раз через минуту");
      return null;
    }
    const { search, network, keywords, negativeKeywords } = outcome.output;
    return { ...current, ads: { search, network }, keywords: { search: keywords, negative: negativeKeywords } };
  };

  const onNext = async (override?: OnboardingDraft) => {
    const next = override ?? draft;
    if (step === 1) {
      await extractCard();
      return;
    }
    if (step === 4 && (next.ads === null || next.keywords === null)) {
      const generated = await generateCreatives(next);
      if (generated !== null) {
        void goTo(5, generated);
      }
      return;
    }
    void goTo(step + 1, next);
  };

  const regenerate = async () => {
    const generated = await generateCreatives(draft);
    if (generated !== null) {
      setDraft(generated);
    }
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
        {step === 2 && notice ? <Alert type="warning" showIcon title={notice} style={{ marginBottom: 16 }} /> : null}
        {step === 2 ? <CardStep {...stepProps} /> : null}
        {step === 3 ? <GoalsStep {...stepProps} /> : null}
        {step === 4 ? <BudgetStep {...stepProps} today={todayIn(draft.card.timeZone)} /> : null}
        {step === 5 ? <PreviewStep {...stepProps} onRegenerate={() => void regenerate()} busy={busy !== null} /> : null}
        {step === 6 ? <DirectStep directApiMode={directApiMode} connected={draft.directConnected} outcome={directOutcome} onConnect={() => void onNext({ ...draft, directConnected: true })} /> : null}
        {step === 7 ? <LaunchStep draft={draft} today={todayIn(draft.card.timeZone)} minWeeklyLimitRub={minWeeklyLimitRub} /> : null}
      </Card>
      {busy ? <Alert type="info" showIcon title={busy} data-testid="wizard-busy" /> : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
      {step < STEP_COUNT && problems.length > 0 ? (
        <Alert type="info" showIcon title="Чтобы перейти дальше" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>} data-testid="step-hint" />
      ) : null}
      <Flex gap={8} justify="space-between">
        {step > 1 ? (
          <Button size="large" onClick={() => void goTo(step - 1, draft)} disabled={saving || busy !== null}>
            Назад
          </Button>
        ) : (
          <span />
        )}
        {step < STEP_COUNT && !(step === 6 && !draft.directConnected) ? (
          <Button type="primary" size="large" onClick={() => void onNext()} disabled={problems.length > 0} loading={saving || busy !== null}>
            Дальше
          </Button>
        ) : null}
      </Flex>
    </Flex>
  );
}

const todayIn = (timeZone: string): string => toLocalDate(new Date(), timeZone);
