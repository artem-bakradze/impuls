"use client";

import { toLocalDate } from "@impuls/core";
import { ArrowLeftOutlined, ArrowRightOutlined, CheckOutlined, InfoCircleOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, Button } from "antd";
import { useState } from "react";
import type { Creatives, ExtractCardResult } from "@impuls/worker";
import { callApi, LLM_POLL_ATTEMPTS, runWebJob } from "@/lib/client-api";
import { mergeExtractedCard, STEP_COUNT, stepProblems, WIZARD_STEPS } from "@/lib/onboarding";
import type { DirectOAuthOutcome } from "@/lib/direct-oauth";
import type { OnboardingDraft } from "@/lib/onboarding";
import { Note } from "../ui/primitives";
import { BudgetStep } from "./BudgetStep";
import { CardStep } from "./CardStep";
import { DirectStep } from "./DirectStep";
import { GenerationProgress } from "./GenerationProgress";
import type { GenerationKind } from "./GenerationProgress";
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

/** Seven steps grouped into three stages the owner can keep in mind. */
const STAGES = [
  { label: "О бизнесе", steps: [1, 2, 3] },
  { label: "Бюджет и объявления", steps: [4, 5] },
  { label: "Запуск", steps: [6, 7] },
] as const;

const LEADS: Record<number, string> = {
  1: "Ссылка на сайт обязательна — на него будет вести реклама. Карты, ВКонтакте и пара слов о вас помогут нам точнее понять бизнес.",
  2: "Проверьте карточку — по ней мы напишем объявления. Чего не нашли, мы не придумываем: допишите сами.",
  3: "Что считать обращением — действием, после которого человек может стать вашим клиентом. По этому мы будем судить, какая реклама работает.",
  4: "Сколько вы готовы тратить в месяц и сколько платить за одно обращение. Больше бюджета мы не потратим никогда.",
  5: "Мы написали объявления по вашей карточке. Поправьте текст или уберите лишнее — до запуска их никто не увидит.",
  6: "Реклама будет работать в вашем аккаунте Яндекс Директа: деньги списываются с его баланса.",
  7: "Проверьте всё ещё раз. После запуска Яндекс проверит объявления — обычно это занимает несколько часов.",
};

function Stages({ step }: { step: number }) {
  return (
    <div className="stages" aria-hidden="true">
      {STAGES.map((stage) => {
        const first = stage.steps[0];
        const last = stage.steps[stage.steps.length - 1] ?? first;
        const state = step > last ? "done" : step >= first ? "current" : "todo";
        const fill = state === "done" ? 100 : state === "current" ? ((step - first + 1) / stage.steps.length) * 100 : 0;
        return (
          <div className="stage" data-state={state} key={stage.label}>
            <div className="stage-bar">
              <i style={{ width: `${fill}%` }} />
            </div>
            <div className="stage-label">
              {state === "done" ? <CheckOutlined /> : null}
              {stage.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Wizard({ initialDraft, initialStep, directApiMode, directOutcome, minWeeklyLimitRub }: WizardProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [step, setStep] = useState(initialStep);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the worker is doing right now (reading pages, writing ads); blocks the buttons. */
  const [busy, setBusy] = useState<GenerationKind | null>(null);
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    setBusy("extract");
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
    setBusy("generate");
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
  const working = saving || busy !== null;
  const showNext = step < STEP_COUNT && !(step === 6 && !draft.directConnected);

  return (
    <div className="wizard">
      <Stages step={step} />
      <div className="step-head fade-in" key={`head-${step}`}>
        <span className="t-eyebrow" data-testid="wizard-step">
          Шаг {step} из {STEP_COUNT}
        </span>
        <h1 className="t-h1">{WIZARD_STEPS[step - 1]}</h1>
        <p className="t-lead">{LEADS[step]}</p>
      </div>

      <div className="stack fade-in" key={`body-${step}`}>
        {step === 2 && notice ? (
          <Note tone="warning" icon={<WarningOutlined aria-hidden="true" />}>
            {notice}
          </Note>
        ) : null}
        {busy !== null && step !== 5 ? (
          <GenerationProgress kind={busy} />
        ) : (
          <div className="surface surface-pad">
            {step === 1 ? <SourcesStep {...stepProps} /> : null}
            {step === 2 ? <CardStep {...stepProps} /> : null}
            {step === 3 ? <GoalsStep {...stepProps} /> : null}
            {step === 4 ? <BudgetStep {...stepProps} today={todayIn(draft.card.timeZone)} /> : null}
            {step === 5 ? <PreviewStep {...stepProps} onRegenerate={() => void regenerate()} busy={busy !== null} /> : null}
            {step === 6 ? <DirectStep directApiMode={directApiMode} connected={draft.directConnected} outcome={directOutcome} onConnect={() => void onNext({ ...draft, directConnected: true })} /> : null}
            {step === 7 ? <LaunchStep draft={draft} today={todayIn(draft.card.timeZone)} minWeeklyLimitRub={minWeeklyLimitRub} /> : null}
          </div>
        )}
        {busy !== null && step === 5 ? <GenerationProgress kind={busy} /> : null}
        {error ? <Alert type="error" showIcon title={error} /> : null}
      </div>

      <div className="wizard-footer">
        <div className="wizard-footer-inner">
          {step > 1 ? (
            <Button size="large" icon={<ArrowLeftOutlined aria-hidden="true" />} onClick={() => void goTo(step - 1, draft)} disabled={working}>
              Назад
            </Button>
          ) : null}
          <div className="wizard-hint" data-testid="step-hint" aria-live="polite">
            {showNext && problems.length > 0 && busy === null ? (
              <span>
                <InfoCircleOutlined style={{ marginRight: 6 }} />
                {problems[0]}
                {problems.length > 1 ? ` и ещё ${problems.length - 1}` : ""}
              </span>
            ) : null}
          </div>
          {showNext ? (
            <Button type="primary" size="large" onClick={() => void onNext()} disabled={problems.length > 0} loading={working} icon={<ArrowRightOutlined aria-hidden="true" />} iconPlacement="end">
              Дальше
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const todayIn = (timeZone: string): string => toLocalDate(new Date(), timeZone);
