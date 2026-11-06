"use client";

import { toLocalDate } from "@impuls/core";
import { ArrowLeftOutlined, ArrowRightOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, Button } from "antd";
import { useEffect, useRef, useState } from "react";
import type { Creatives, DrawnImages, ExtractCardResult } from "@impuls/worker";
import type { AccountMode } from "@/lib/account-mode";
import { callApi, LLM_POLL_ATTEMPTS, runWebJob } from "@/lib/client-api";
import { launchStepWords } from "@/lib/launch-step";
import { mergeExtractedCard, pictureKey, STEP_COUNT, stepIssues, unreadableNotice, WIZARD_STEPS, withNormalizedLinks } from "@/lib/onboarding";
import type { DirectOAuthOutcome } from "@/lib/direct-oauth";
import type { NetworkAdDraft, OnboardingDraft } from "@/lib/onboarding";
import { Note } from "../ui/primitives";
import { BudgetStep } from "./BudgetStep";
import { CardStep } from "./CardStep";
import { DirectStep } from "./DirectStep";
import { GenerationProgress } from "./GenerationProgress";
import type { GenerationKind } from "./GenerationProgress";
import { LaunchStep } from "./LaunchStep";
import { PreviewStep } from "./PreviewStep";
import { SourcesStep } from "./SourcesStep";
import { simulationStartDate } from "@impuls/worker/simulation-period";

export interface WizardProps {
  initialDraft: OnboardingDraft;
  initialStep: number;
  directApiMode: "simulator" | "production";
  /** The account's mode: a demo launches the simulation, other logins Direct; the wizard has no choice of its own. */
  mode: AccountMode;
  /** Result of the Yandex OAuth redirect back to the wizard, if any. */
  directOutcome: DirectOAuthOutcome | null;
}

export interface StepProps {
  draft: OnboardingDraft;
  onChange: (draft: OnboardingDraft) => void;
  /** Field id → message, shown after the owner pressed «Дальше» with something missing. */
  errors?: Record<string, string>;
}

/** Leads of the first two steps; the last one speaks of the account's mode (`launchStepWords`). */
const LEADS: Record<number, string> = {
  1: "На ваш сайт будет вести реклама. По нему мы поймём, чем вы занимаетесь.",
  2: "По этой карточке мы напишем объявления. Чего не нашли, не придумываем — допишите сами.",
};

/** One progress indicator: three segments, read together with «Шаг N из 3». */
function Progress({ step }: { step: number }) {
  return (
    <div className="steps-bar" aria-hidden="true">
      {WIZARD_STEPS.map((title, index) => (
        <i key={title} data-state={index + 1 < step ? "done" : index + 1 === step ? "current" : "todo"} />
      ))}
    </div>
  );
}

export function Wizard({ initialDraft, initialStep, directApiMode, mode, directOutcome }: WizardProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [step, setStep] = useState(initialStep);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the worker is doing right now (reading pages, writing ads); blocks the buttons. */
  const [busy, setBusy] = useState<GenerationKind | null>(null);
  /** Shown on the card step when a page could not be read. */
  const [notice, setNotice] = useState<string | null>(null);

  /** Partner-site pictures being drawn (network-ad-images), by `pictureKey`; «Запустить» stays available meanwhile. */
  const [drawing, setDrawing] = useState<ReadonlySet<string>>(new Set());
  /** Pictures already asked for on this visit, so a failed request is not repeated by itself. */
  const asked = useRef(new Set<string>());
  /** Requests on their way: a second click or effect run does not draw the same picture twice. */
  const inFlight = useRef(new Set<string>());

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
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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
      setNotice(unreadableNotice(outcome.output.unreadable, next));
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
    // New texts get their own pictures, even when a title repeats an earlier one.
    asked.current.clear();
    return { ...current, ads: { search, network }, keywords: { search: keywords, negative: negativeKeywords } };
  };

  /**
   * Draws pictures after the texts, so they never hold the texts up: an ad's first picture, or «Другая картинка» /
   * «Попробовать ещё раз» for its current one. A picture that does not come leaves the ad as it was; the worker draws a
   * missing one at launch.
   */
  const drawPictures = async (ads: readonly Pick<NetworkAdDraft, "title" | "imageId">[]) => {
    const requests = ads
      .filter((ad) => ad.title.trim() !== "" && !inFlight.current.has(pictureKey(ad)))
      .map((ad) => ({ key: pictureKey(ad), title: ad.title, previousImageId: ad.imageId ?? null }));
    if (requests.length === 0) return;
    for (const request of requests) {
      asked.current.add(request.key);
      inFlight.current.add(request.key);
    }
    setDrawing((current) => new Set([...current, ...requests.map((r) => r.key)]));
    const outcome = await runWebJob<DrawnImages>("/api/onboarding/ad-images", { ads: requests.map(({ title, previousImageId }) => ({ title, previousImageId })) }, LLM_POLL_ATTEMPTS);
    for (const request of requests) inFlight.current.delete(request.key);
    setDrawing((current) => new Set([...current].filter((key) => !requests.some((r) => r.key === key))));
    if (outcome.kind !== "done") return;
    setDraft((current) => {
      if (current.ads === null) return current;
      const network = current.ads.network.map((ad) => {
        const drawn = outcome.output.images[requests.findIndex((r) => r.key === pictureKey(ad))];
        return drawn === undefined ? ad : { ...ad, imageId: drawn.imageId, imageNote: drawn.note };
      });
      return { ...current, ads: { ...current.ads, network } };
    });
  };

  // The preview step draws the pictures the ads do not have yet: new texts, or a draft made before the pictures.
  const missing = step === STEP_COUNT ? (draft.ads?.network ?? []).filter((ad) => ad.imageId === undefined && !asked.current.has(pictureKey(ad))) : [];
  const missingKeys = missing.map(pictureKey).join("\n");
  useEffect(() => {
    if (missing.length > 0) void drawPictures(missing);
    // Runs when the set of ads without a picture changes, not on every render.
  }, [missingKeys]);

  /** «Дальше» is always pressable: with something missing it shows the errors and scrolls to the first one. */
  const onNext = async () => {
    const found = stepIssues(step, draft);
    if (found.length > 0) {
      setAttempted(true);
      requestAnimationFrame(() => {
        const first = document.getElementById(`field-${found[0]?.field ?? ""}`);
        first?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
        first?.querySelector<HTMLElement>("input, textarea, [role=combobox], button")?.focus({ preventScroll: true });
      });
      return;
    }
    const next = step === 1 ? withNormalizedLinks(draft) : draft;
    if (step === 1) {
      setDraft(next);
      await extractCard(next);
      return;
    }
    // The ads are written from the confirmed card when the owner leaves step 2.
    if (step === 2 && (next.ads === null || next.keywords === null)) {
      const generated = await generateCreatives(next);
      if (generated !== null) {
        void goTo(3, generated);
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
  const launchWords = launchStepWords(mode);
  // The day the ads start: a simulation starts on the 1st of the next month, so its budget is a full month and the
  // owner sees no prorated month and no month names (simulation-mode «Дни симуляции вместо дат»).
  const launchDay = mode === "simulation" ? simulationStartDate(todayIn(draft.card.timeZone)) : todayIn(draft.card.timeZone);
  /** «изменить» of the summary: the card and the budget are on step 2; the ads are on this very step. */
  const edit = (target: number) => {
    if (target >= STEP_COUNT) {
      document.getElementById("field-ads")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      return;
    }
    void goTo(target, draft);
  };

  return (
    <div className="wizard">
      <Progress step={step} />
      <div className="step-head fade-in" key={`head-${step}`}>
        <span className="t-eyebrow" data-testid="wizard-step">
          Шаг {step} из {STEP_COUNT}
        </span>
        <h1 className="t-h1">{step === STEP_COUNT ? launchWords.title : WIZARD_STEPS[step - 1]}</h1>
        <p className="t-lead">{step === STEP_COUNT ? launchWords.lead : LEADS[step]}</p>
      </div>

      <div className="stack fade-in" key={`body-${step}`}>
        {step === 2 && notice ? (
          <Note tone="warning" icon={<WarningOutlined aria-hidden="true" />}>
            {notice}
          </Note>
        ) : null}
        {busy !== null && step !== STEP_COUNT ? (
          <GenerationProgress kind={busy} />
        ) : (
          <>
            {step === 1 ? <div className="surface surface-pad"><SourcesStep {...stepProps} /></div> : null}
            {step === 2 ? (
              <>
                <div className="surface surface-pad"><CardStep {...stepProps} /></div>
                <div className="surface surface-pad" data-testid="budget-step">
                  <BudgetStep {...stepProps} today={launchDay} />
                </div>
              </>
            ) : null}
            {step === STEP_COUNT ? (
              <>
                <div className="surface surface-pad"><PreviewStep {...stepProps} onRegenerate={() => void regenerate()} busy={busy !== null} drawing={drawing} onRedraw={(ad) => void drawPictures([ad])} /></div>
                {busy !== null ? <GenerationProgress kind={busy} /> : null}
                <div className="surface surface-pad">
                  <div className="stack" style={{ "--gap": "24px" } as React.CSSProperties}>
                    {launchWords.connectsDirect ? (
                      <>
                        <DirectStep directApiMode={directApiMode} connected={draft.directConnected} outcome={directOutcome} onConnect={() => void goTo(STEP_COUNT, { ...draft, directConnected: true })} />
                        {draft.directConnected ? <LaunchStep draft={draft} onChange={setDraft} errors={errors} today={launchDay} onEdit={edit} save={() => saveHere(draft)} mode={mode} /> : null}
                      </>
                    ) : (
                      <LaunchStep
                        draft={draft}
                        onChange={setDraft}
                        errors={errors}
                        today={launchDay}
                        onEdit={edit}
                        save={() => saveHere(draft)}
                        mode={mode}
                      />
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </>
        )}
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
