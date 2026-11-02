"use client";

import { toLocalDate } from "@impuls/core";
import { ArrowLeftOutlined, ArrowRightOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, Button } from "antd";
import { useState } from "react";
import type { Creatives, ExtractCardResult } from "@impuls/worker";
import { callApi, LLM_POLL_ATTEMPTS, runWebJob } from "@/lib/client-api";
import { mergeExtractedCard, SIMULATION_STEP_TITLE, STEP_COUNT, stepIssues, WIZARD_STEPS, withNormalizedLinks } from "@/lib/onboarding";
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
import { defaultScenario, ModeChoice, ScenarioPicker } from "./SimulationChoice";
import type { LaunchMode } from "./SimulationChoice";
import { SourcesStep } from "./SourcesStep";
import { SCENARIOS, scenarioStartDate } from "@impuls/worker/scenarios";
import type { ScenarioId } from "@impuls/worker/scenarios";

export interface WizardProps {
  initialDraft: OnboardingDraft;
  initialStep: number;
  directApiMode: "simulator" | "production";
  /** Result of the Yandex OAuth redirect back to the wizard, if any. */
  directOutcome: DirectOAuthOutcome | null;
}

export interface StepProps {
  draft: OnboardingDraft;
  onChange: (draft: OnboardingDraft) => void;
  /** Field id → message, shown after the owner pressed «Дальше» with something missing. */
  errors?: Record<string, string>;
}

const LEADS: Record<number, string> = {
  1: "Ссылка на сайт обязательна — на него будет вести реклама. Карты, ВКонтакте и пара слов о вас помогут нам точнее понять бизнес.",
  2: "Проверьте карточку — по ней мы напишем объявления. Чего не нашли, мы не придумываем: допишите сами.",
  3: "Что считать обращением — действием, после которого человек может стать вашим клиентом. По этому мы будем судить, какая реклама работает.",
  4: "Больше этой суммы мы не потратим никогда, а цену обращения подберём сами.",
  5: "Мы написали объявления по вашей карточке. Поправьте текст или уберите лишнее — до запуска их никто не увидит.",
  6: "Реклама будет работать в вашем аккаунте Яндекс Директа: деньги списываются с его баланса. Подключите его, проверьте итог и запускайте.",
};

/** Step 6 when the simulation is chosen: nothing about the Direct balance (business-onboarding spec). */
const SIMULATION_LEAD = "Тот же сервис на симуляторе рынка: месяц рекламы пройдёт примерно за 5 минут, без денег и без Директа. Проверьте итог и запускайте.";

/** One progress indicator: six segments, read together with «Шаг N из 6». */
function Progress({ step }: { step: number }) {
  return (
    <div className="steps-bar" aria-hidden="true">
      {WIZARD_STEPS.map((title, index) => (
        <i key={title} data-state={index + 1 < step ? "done" : index + 1 === step ? "current" : "todo"} />
      ))}
    </div>
  );
}

export function Wizard({ initialDraft, initialStep, directApiMode, directOutcome }: WizardProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [step, setStep] = useState(initialStep);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the worker is doing right now (reading pages, writing ads); blocks the buttons. */
  const [busy, setBusy] = useState<GenerationKind | null>(null);
  /** Shown on the card step when a page could not be read. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Step 6: real Direct or the simulation with a market scenario (simulation-mode spec). */
  const [mode, setMode] = useState<LaunchMode>("direct");
  const [scenario, setScenario] = useState<ScenarioId | null>(null);

  /** Errors are shown only after the owner tried to move on, not while they are still typing. */
  const [attempted, setAttempted] = useState(false);
  const issues = stepIssues(step, draft);
  const errors = attempted ? Object.fromEntries([...issues].reverse().map((issue) => [issue.field, issue.message])) : {};

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
    setAttempted(false);
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
  const extractCard = async (current: OnboardingDraft) => {
    setError(null);
    setBusy("extract");
    if (!(await saveHere(current))) {
      setBusy(null);
      return;
    }
    const outcome = await runWebJob<ExtractCardResult>("/api/onboarding/extract", undefined, LLM_POLL_ATTEMPTS);
    setBusy(null);
    let next = current;
    if (outcome.kind === "done") {
      next = mergeExtractedCard(current, outcome.output.card);
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

  /** «Дальше» is always pressable: with something missing it shows the errors and scrolls to the first one. */
  const onNext = async () => {
    const found = stepIssues(step, draft);
    if (found.length > 0) {
      setAttempted(true);
      const first = document.getElementById(`field-${found[0]?.field ?? ""}`);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.querySelector<HTMLElement>("input, textarea, [role=combobox], button")?.focus({ preventScroll: true });
      return;
    }
    const next = step === 1 ? withNormalizedLinks(draft) : draft;
    if (step === 1) {
      setDraft(next);
      await extractCard(next);
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

  const stepProps: StepProps = { draft, onChange: setDraft, errors };
  const working = saving || busy !== null;
  const showNext = step < STEP_COUNT;
  const simulating = step === 6 && mode === "simulation";
  const chooseMode = (next: LaunchMode) => {
    setMode(next);
    // The recommended scenario is selected in advance, so «Запустить симуляцию» is there right away.
    if (next === "simulation" && scenario === null) setScenario(defaultScenario(draft));
  };

  return (
    <div className="wizard">
      <Progress step={step} />
      <div className="step-head fade-in" key={`head-${step}`}>
        <span className="t-eyebrow" data-testid="wizard-step">
          Шаг {step} из {STEP_COUNT}
        </span>
        <h1 className="t-h1">{simulating ? SIMULATION_STEP_TITLE : WIZARD_STEPS[step - 1]}</h1>
        <p className="t-lead">{simulating ? SIMULATION_LEAD : LEADS[step]}</p>
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
            {step === 6 ? (
              <div className="stack" style={{ "--gap": "24px" } as React.CSSProperties}>
                <ModeChoice mode={mode} onChange={chooseMode} />
                {mode === "direct" ? (
                  <>
                    <DirectStep directApiMode={directApiMode} connected={draft.directConnected} outcome={directOutcome} onConnect={() => void goTo(6, { ...draft, directConnected: true })} />
                    {draft.directConnected ? <LaunchStep draft={draft} today={todayIn(draft.card.timeZone)} onEdit={(target) => void goTo(target, draft)} /> : null}
                  </>
                ) : (
                  <>
                    <ScenarioPicker draft={draft} scenario={scenario} onChange={setScenario} onEdit={(target) => void goTo(target, draft)} />
                    {scenario !== null ? (
                      <LaunchStep
                        draft={draft}
                        // The simulated month starts on its own date, so the budget line is for that month.
                        today={scenarioStartDate(SCENARIOS[scenario], todayIn(draft.card.timeZone))}
                        onEdit={(target) => void goTo(target, draft)}
                        simulation={{ scenario }}
                      />
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
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
          <span className="spacer" />
          {showNext ? (
            <Button type="primary" size="large" onClick={() => void onNext()} loading={working} icon={<ArrowRightOutlined aria-hidden="true" />} iconPlacement="end">
              Дальше
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const todayIn = (timeZone: string): string => toLocalDate(new Date(), timeZone);
