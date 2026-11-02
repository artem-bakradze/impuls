"use client";

import {
  ClockCircleOutlined,
  CodeOutlined,
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  NotificationOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ShopOutlined,
  UserOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { Alert, Button, Collapse, Input, InputNumber, Select } from "antd";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { PENDING_TEXT, runWebJob, runWebJobs } from "@/lib/client-api";
import type { CommandResult, JobOutcome } from "@/lib/client-api";
import { formatRub, sentence } from "@/lib/format";
import { AD_TEXT_MAX, AD_TITLE_MAX, DAY_OPTIONS, HOUR_OPTIONS, MIN_BUDGET_RUB } from "@/lib/onboarding";
import { MODERATION_WORDS } from "@/lib/settings-model";
import type { SettingsModel } from "@/lib/settings-model";
import { channelLabel } from "@/lib/summary-model";
import { Chip, Note, PageHead } from "../ui/primitives";
import type { Tone } from "../ui/primitives";

type Feedback = { section: string; type: "success" | "error" | "info" | "warning"; text: string; confirmBudget?: number } | null;
type BudgetResult = { kind: "ok" | "will_stop"; monthBudgetRub: number; message: string; applied: boolean };

const commandsFeedback = (section: string, outcome: JobOutcome<CommandResult[]>, success: string): NonNullable<Feedback> => {
  if (outcome.kind === "pending") return { section, type: "info", text: PENDING_TEXT };
  if (outcome.kind === "error") return { section, type: "error", text: outcome.message };
  const failed = outcome.output.find((r) => r.status === "rejected" || r.status === "failed");
  if (failed) return { section, type: "error", text: `Не получилось: ${failed.message}` };
  const clamped = outcome.output.find((r) => r.status === "clamped");
  return clamped ? { section, type: "warning", text: sentence(clamped.message) } : { section, type: "success", text: success };
};

const rubFormatter = (value: number | string | undefined): string => (value === undefined || value === "" ? "" : `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, " "));
const rubParser = (value: string | undefined): number => Number((value ?? "").replace(/\D/g, ""));

function SectionFeedback({ feedback, section, onConfirmBudget }: { feedback: Feedback; section: string; onConfirmBudget?: (amount: number) => void }) {
  if (feedback?.section !== section) return null;
  return (
    <Alert
      style={{ marginTop: 12 }}
      type={feedback.type}
      showIcon
      title={feedback.text}
      action={
        feedback.confirmBudget !== undefined && onConfirmBudget ? (
          <Button danger onClick={() => onConfirmBudget(feedback.confirmBudget ?? 0)}>
            Всё равно изменить
          </Button>
        ) : undefined
      }
    />
  );
}

type CardDraft = SettingsModel["card"];

const tidyCard = (card: CardDraft): CardDraft => ({
  category: card.category.trim(),
  services: card.services.filter((s) => s.name.trim() !== "").map((s) => ({ name: s.name.trim(), priceRub: s.priceRub })),
  advantages: card.advantages.map((a) => a.trim()).filter((a) => a !== ""),
});

/** «Что рекламируем» in edit mode: the facts new ad variants are written from (campaign-settings spec). */
function CardEditor({ card, onChange }: { card: CardDraft; onChange: (card: CardDraft) => void }) {
  const setService = (index: number, patch: Partial<CardDraft["services"][number]>) =>
    onChange({ ...card, services: card.services.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  return (
    <div className="stack" style={{ "--gap": "18px" } as React.CSSProperties}>
      <div className="field">
        <div className="field-label">Чем вы занимаетесь</div>
        <Input value={card.category} maxLength={100} onChange={(e) => onChange({ ...card, category: e.target.value })} aria-label="Чем вы занимаетесь" style={{ maxWidth: 420 }} />
      </div>
      <div className="field">
        <div className="field-label">Услуги и цены</div>
        {card.services.map((service, index) => (
          <div key={index} className="row" style={{ "--gap": "8px", flexWrap: "nowrap" } as React.CSSProperties}>
            <Input style={{ flex: 1, minWidth: 0 }} value={service.name} maxLength={100} onChange={(e) => setService(index, { name: e.target.value })} aria-label={`Услуга ${index + 1}`} placeholder="Услуга" />
            <InputNumber
              style={{ width: 132, flex: "none" }}
              min={1}
              value={service.priceRub}
              onChange={(value) => setService(index, { priceRub: typeof value === "number" ? Math.round(value) : null })}
              placeholder="Цена"
              suffix="₽"
              aria-label={`Цена услуги ${index + 1}`}
            />
            {card.services.length > 1 ? (
              <Button type="text" icon={<DeleteOutlined aria-hidden="true" />} onClick={() => onChange({ ...card, services: card.services.filter((_, i) => i !== index) })} aria-label={`Убрать услугу ${index + 1}`} />
            ) : null}
          </div>
        ))}
        {card.services.length < 20 ? (
          <Button type="dashed" icon={<PlusOutlined aria-hidden="true" />} onClick={() => onChange({ ...card, services: [...card.services, { name: "", priceRub: null }] })} style={{ alignSelf: "flex-start" }}>
            Добавить услугу
          </Button>
        ) : null}
      </div>
      <div className="field">
        <div className="field-label">Чем вы лучше других</div>
        {card.advantages.map((advantage, index) => (
          <Input
            key={index}
            value={advantage}
            maxLength={100}
            onChange={(e) => onChange({ ...card, advantages: card.advantages.map((a, i) => (i === index ? e.target.value : a)) })}
            aria-label={`Преимущество ${index + 1}`}
            placeholder="Например: работаем без выходных"
          />
        ))}
        {card.advantages.length < 3 ? (
          <Button type="dashed" icon={<PlusOutlined aria-hidden="true" />} onClick={() => onChange({ ...card, advantages: [...card.advantages, ""] })} style={{ alignSelf: "flex-start" }}>
            Добавить пункт
          </Button>
        ) : null}
        <div className="field-help">1–3 коротких факта. Без «лучший» — такие слова запрещены законом о рекламе.</div>
      </div>
    </div>
  );
}

const SECTIONS = [
  { id: "business", label: "Что рекламируем", icon: <ShopOutlined /> },
  { id: "where", label: "Где и когда", icon: <EnvironmentOutlined /> },
  { id: "budget", label: "Бюджет и цель", icon: <WalletOutlined /> },
  { id: "ads", label: "Объявления", icon: <NotificationOutlined /> },
  { id: "site", label: "Сайт", icon: <GlobalOutlined /> },
  { id: "account", label: "Аккаунт", icon: <UserOutlined /> },
];

function Section({ id, title, lead, children, testId }: { id: string; title: string; lead?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section id={id} className="surface settings-section" data-testid={testId}>
      <div className="surface-head">
        <div className="stack" style={{ "--gap": "4px" } as React.CSSProperties}>
          <h2 className="t-h3">{title}</h2>
          {lead ? <span className="t-small">{lead}</span> : null}
        </div>
      </div>
      <div className="surface-body">{children}</div>
    </section>
  );
}

/** One status per ad instead of two badges: off, being checked, rejected or showing. */
const adState = (ad: SettingsModel["ads"][number]): { tone: Tone; text: string } => {
  if (ad.status !== "active") return { tone: "neutral", text: "Отключено" };
  if (ad.moderation === "rejected") return { tone: "danger", text: MODERATION_WORDS.rejected };
  if (ad.moderation === "pending") return { tone: "accent", text: MODERATION_WORDS.pending };
  return { tone: "success", text: "Показывается" };
};

export function SettingsView({ model, simulated = false }: { model: SettingsModel; simulated?: boolean }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [city, setCity] = useState(model.city);
  const [days, setDays] = useState(model.schedule.days ?? DAY_OPTIONS[0]);
  const [from, setFrom] = useState(model.schedule.from ?? "10:00");
  const [to, setTo] = useState(model.schedule.to ?? "20:00");
  const [budget, setBudget] = useState<number | null>(model.monthlyBudgetRub);
  const [adEdits, setAdEdits] = useState<Record<string, { title: string; text: string }>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [goalMode, setGoalMode] = useState(model.goal.mode);
  const [goalRub, setGoalRub] = useState<number | null>(model.goal.mode === "user" ? model.goal.rub : null);
  const [cardEdit, setCardEdit] = useState<CardDraft | null>(null);

  const done = (next: NonNullable<Feedback>) => {
    setFeedback(next);
    setBusy(null);
    if (next.type === "success" || next.type === "warning") router.refresh();
  };

  const commands = async (section: string, body: unknown, success: string) => {
    setBusy(section);
    done(commandsFeedback(section, await runWebJobs<CommandResult>("/api/commands", body), success));
  };

  const saveBudget = async (amount: number, confirmed: boolean) => {
    setBusy("budget");
    const outcome = await runWebJob<BudgetResult>("/api/budget", { monthlyBudgetRub: amount, confirmed });
    if (outcome.kind === "pending") return done({ section: "budget", type: "info", text: PENDING_TEXT });
    if (outcome.kind === "error") return done({ section: "budget", type: "error", text: outcome.message });
    if (!outcome.output.applied) {
      return done({ section: "budget", type: "warning", text: outcome.output.message, confirmBudget: amount });
    }
    done({ section: "budget", type: "success", text: `Бюджет изменён. ${outcome.output.message}` });
  };

  const saveCard = async (card: CardDraft) => {
    setBusy("card");
    const next = commandsFeedback("card", await runWebJobs<CommandResult>("/api/commands", { action: "card", card }), "Описание сохранено. Работающие объявления сами не меняются — проверьте их тексты в разделе «Объявления».");
    if (next.type === "success") setCardEdit(null);
    done(next);
  };

  const schedule = `${days} ${from}–${to}`;
  // Save buttons appear only after a change in their section (campaign-settings spec).
  const cityChanged = city.trim() !== model.city;
  const budgetChanged = budget !== model.monthlyBudgetRub;
  const goalChanged = goalMode !== model.goal.mode || (goalMode === "user" && goalRub !== model.goal.rub);
  const cardTidy = cardEdit === null ? null : tidyCard(cardEdit);
  const cardChanged = cardTidy !== null && JSON.stringify(cardTidy) !== JSON.stringify(tidyCard(model.card));

  return (
    <div className="page">
      <PageHead
        title="Настройки"
        lead={
          simulated
            ? "Меняйте простым языком — изменения сразу применятся в симуляции, в той же истории и с тем же откатом."
            : "Меняйте простым языком — сервис сам перенесёт изменения в Яндекс Директ за несколько минут."
        }
        extra={
          model.paused ? (
            <Button type="primary" size="large" icon={<PlayCircleOutlined aria-hidden="true" />} onClick={() => void commands("pause", { action: "resumeAll" }, "Реклама снова работает")} loading={busy === "pause"}>
              Возобновить рекламу
            </Button>
          ) : (
            <Button size="large" icon={<PauseCircleOutlined aria-hidden="true" />} onClick={() => void commands("pause", { action: "pauseAll" }, "Реклама на паузе. Пока она стоит, сервис ничего не меняет")} loading={busy === "pause"}>
              Поставить рекламу на паузу
            </Button>
          )
        }
      />
      <SectionFeedback feedback={feedback} section="pause" />
      {model.paused ? (
        <div style={{ marginBottom: 16 }}>
          <Note tone="warning" icon={<PauseCircleOutlined aria-hidden="true" />}>
            <strong>Реклама на паузе</strong>
          </Note>
        </div>
      ) : null}

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Разделы настроек">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              <span aria-hidden="true">{s.icon}</span>
              {s.label}
            </a>
          ))}
        </nav>

        <div className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
          <Section id="business" title="Что рекламируем" lead="По этим фактам мы пишем новые варианты объявлений" testId="card-section">
            {cardEdit === null ? (
              <div className="stack" style={{ "--gap": "14px" } as React.CSSProperties}>
                <dl className="kv">
                  <dt>Чем занимаетесь</dt>
                  <dd>{model.card.category || "не указано"}</dd>
                  <dt>Услуги</dt>
                  <dd>{model.card.services.map((s) => (s.priceRub === null ? s.name : `${s.name} — ${formatRub(s.priceRub * 100)}`)).join("; ")}</dd>
                  <dt>Преимущества</dt>
                  <dd>{model.card.advantages.join("; ") || "не указаны"}</dd>
                </dl>
                <Button
                  icon={<EditOutlined aria-hidden="true" />}
                  onClick={() => setCardEdit({ ...model.card, services: model.card.services.length > 0 ? model.card.services : [{ name: "", priceRub: null }], advantages: model.card.advantages.length > 0 ? model.card.advantages : [""] })}
                  style={{ alignSelf: "flex-start" }}
                >
                  Изменить описание
                </Button>
              </div>
            ) : (
              <div className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
                <CardEditor card={cardEdit} onChange={setCardEdit} />
                <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                  {cardChanged && cardTidy ? (
                    <Button type="primary" disabled={cardTidy.services.length === 0} loading={busy === "card"} onClick={() => void saveCard(cardTidy)}>
                      Сохранить описание
                    </Button>
                  ) : null}
                  <Button onClick={() => setCardEdit(null)} disabled={busy === "card"}>
                    Отмена
                  </Button>
                </div>
                {cardTidy && cardTidy.services.length === 0 ? <span className="field-error">Оставьте хотя бы одну услугу — о ней будут объявления</span> : null}
              </div>
            )}
            <SectionFeedback feedback={feedback} section="card" />
          </Section>

          <Section id="where" title="Где и когда" lead="Реклама показывается людям в вашем городе">
            <div className="stack" style={{ "--gap": "22px" } as React.CSSProperties}>
              <div className="field">
                <div className="field-label">
                  <EnvironmentOutlined />
                  Город
                </div>
                <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                  <Input value={city} maxLength={100} onChange={(e) => setCity(e.target.value)} aria-label="Город показа" style={{ width: 240 }} />
                  {cityChanged ? (
                    <Button
                      type="primary"
                      disabled={city.trim() === ""}
                      loading={busy === "city"}
                      onClick={() => void commands("city", { action: "city", city: city.trim() }, "Город обновлён во всей рекламе")}
                    >
                      Сохранить город
                    </Button>
                  ) : null}
                </div>
                <SectionFeedback feedback={feedback} section="city" />
              </div>
              <hr className="divider" />
              <div className="field" data-testid="schedule-section">
                <div className="field-label">
                  <ClockCircleOutlined />
                  Когда показываем
                </div>
                <span className="t-small">Сейчас: {model.schedule.raw || "не задано"}</span>
                <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                  <Select value={days} onChange={setDays} options={DAY_OPTIONS.map((d) => ({ value: d, label: d }))} style={{ width: 120 }} aria-label="Дни показа" />
                  <Select value={from} onChange={setFrom} options={HOUR_OPTIONS.slice(0, 24).map((h) => ({ value: h, label: `с ${h}` }))} style={{ width: 112 }} aria-label="Показывать с" virtual={false} />
                  <Select value={to} onChange={setTo} options={HOUR_OPTIONS.slice(1).map((h) => ({ value: h, label: `до ${h}` }))} style={{ width: 112 }} aria-label="Показывать до" virtual={false} />
                  {schedule !== model.schedule.raw ? (
                    <Button
                      type="primary"
                      disabled={from === to}
                      loading={busy === "schedule"}
                      onClick={() => void commands("schedule", { action: "schedule", schedule }, "Расписание обновлено во всей рекламе")}
                    >
                      Сохранить время
                    </Button>
                  ) : null}
                </div>
                <SectionFeedback feedback={feedback} section="schedule" />
              </div>
            </div>
          </Section>

          <Section id="budget" title="Бюджет и цель" lead="Месячный бюджет — потолок: больше этой суммы мы не потратим никогда">
            <div className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
              <div className="field">
                <div className="field-label">Сколько тратить в месяц, с НДС</div>
                <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                  <InputNumber<number>
                    min={MIN_BUDGET_RUB}
                    step={1000}
                    value={budget}
                    onChange={(v) => setBudget(typeof v === "number" ? Math.round(v) : null)}
                    formatter={rubFormatter}
                    parser={rubParser}
                    suffix="₽"
                    aria-label="Бюджет в месяц"
                    style={{ width: 200 }}
                  />
                  {budgetChanged ? (
                    <Button type="primary" disabled={budget === null || budget < MIN_BUDGET_RUB} loading={busy === "budget"} onClick={() => budget !== null && void saveBudget(budget, false)}>
                      Сохранить бюджет
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
            <SectionFeedback feedback={feedback} section="budget" onConfirmBudget={(amount) => void saveBudget(amount, true)} />
            <hr className="divider" style={{ margin: "18px 0" }} />
            <div className="field" data-testid="goal-section">
              <div className="field-label">Сколько готовы платить за одно обращение</div>
              <span className="t-small">
                Сейчас: {model.goal.mode === "user" ? `до ${formatRub(model.goal.rub * 100)} за обращение` : "подбираем сами по результатам рекламы"}
              </span>
              <div className="presets" role="radiogroup" aria-label="Цена обращения">
                {(
                  [
                    { value: "auto", label: "Подбирайте сами" },
                    { value: "user", label: "Укажу сумму" },
                  ] as const
                ).map((option) => (
                  <button key={option.value} type="button" role="radio" aria-checked={goalMode === option.value} aria-pressed={goalMode === option.value} className="preset" onClick={() => setGoalMode(option.value)}>
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
                {goalMode === "user" ? (
                  <InputNumber<number>
                    min={1}
                    step={50}
                    value={goalRub}
                    onChange={(v) => setGoalRub(typeof v === "number" && v > 0 ? Math.round(v) : null)}
                    formatter={rubFormatter}
                    parser={rubParser}
                    suffix="₽"
                    aria-label="Цена одного обращения"
                    style={{ width: 200 }}
                  />
                ) : null}
                {goalChanged ? (
                  <Button
                    type="primary"
                    disabled={goalMode === "user" && goalRub === null}
                    loading={busy === "goal"}
                    onClick={() =>
                      void commands("goal", { action: "goal", goal: goalMode === "user" ? { mode: "user", rub: goalRub } : { mode: "auto" } }, goalMode === "user" ? "Цель сохранена" : "Теперь цену подбираем сами")
                    }
                  >
                    Сохранить цель
                  </Button>
                ) : null}
              </div>
              <SectionFeedback feedback={feedback} section="goal" />
            </div>
          </Section>

          <Section id="ads" title="Объявления" lead="Новый текст Яндекс проверит заново — обычно за несколько часов">
            {model.ads.map((ad) => {
              const edit = adEdits[ad.id] ?? { title: ad.title, text: ad.text };
              const changed = edit.title !== ad.title || edit.text !== ad.text;
              const state = adState(ad);
              const open = editing === ad.id;
              return (
                <div key={ad.id} className="ad-row">
                  <div className="row" style={{ "--gap": "8px", marginBottom: 8 } as React.CSSProperties}>
                    <Chip tone={state.tone}>{state.text}</Chip>
                    <span className="t-small">{ad.direction}</span>
                    <span className="spacer" />
                    <Button size="small" type="text" icon={<EditOutlined aria-hidden="true" />} onClick={() => setEditing(open ? null : ad.id)}>
                      {open ? "Свернуть" : "Изменить"}
                    </Button>
                    <Button
                      size="small"
                      loading={busy === `status-${ad.id}`}
                      onClick={() => void commands(`status-${ad.id}`, { action: "adStatus", adId: ad.id, active: ad.status !== "active" }, ad.status === "active" ? "Объявление отключено" : "Объявление включено")}
                    >
                      {ad.status === "active" ? "Отключить" : "Включить"}
                    </Button>
                  </div>
                  {open ? (
                    <div className="ad-edit fade-in">
                      <Input value={edit.title} maxLength={AD_TITLE_MAX} showCount onChange={(e) => setAdEdits({ ...adEdits, [ad.id]: { ...edit, title: e.target.value } })} aria-label="Заголовок объявления" />
                      <Input.TextArea value={edit.text} maxLength={AD_TEXT_MAX} showCount autoSize onChange={(e) => setAdEdits({ ...adEdits, [ad.id]: { ...edit, text: e.target.value } })} aria-label="Текст объявления" />
                      {changed ? (
                        <Button type="primary" loading={busy === `text-${ad.id}`} onClick={() => void commands(`text-${ad.id}`, { action: "adText", adId: ad.id, ...edit }, "Текст изменён — Яндекс проверит объявление заново")} style={{ alignSelf: "flex-start" }}>
                          Сохранить текст
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
                      <span style={{ fontWeight: 600, color: "#2a20b8" }}>{edit.title}</span>
                      <span className="t-body t-muted">{edit.text}</span>
                    </div>
                  )}
                  <SectionFeedback feedback={feedback} section={`text-${ad.id}`} />
                  <SectionFeedback feedback={feedback} section={`status-${ad.id}`} />
                </div>
              );
            })}
          </Section>

          <Section id="site" title="Сайт">
            {model.siteUrl ? (
              <div className="stack" style={{ "--gap": "6px" } as React.CSSProperties}>
                <span className="t-body">
                  Объявления ведут на ваш сайт:{" "}
                  <a href={model.siteUrl} target="_blank" rel="noreferrer">
                    {model.siteUrl}
                  </a>
                </span>
                <span className="t-small" data-testid="site-change">
                  Сменили сайт? Напишите нам на <a href={`mailto:${model.supportEmail}`}>{model.supportEmail}</a> — заменим ссылку во всех объявлениях. Яндекс проверит их заново.
                </span>
              </div>
            ) : (
              // Launch requires the owner's site; the mini-site form is out of the MVP (replace-direct-sandbox decision 7).
              <span className="t-small">Адрес сайта не указан</span>
            )}
          </Section>

          <Section id="account" title="Аккаунт">
            <span className="t-body" data-testid="account-deletion">
              Чтобы удалить аккаунт, напишите нам на <a href={`mailto:${model.supportEmail}`}>{model.supportEmail}</a> — мы остановим рекламу и удалим ваши данные в течение 30 дней.
            </span>
          </Section>

          <Collapse
            items={[
              {
                key: "pro",
                label: (
                  <span>
                    <CodeOutlined style={{ marginRight: 8 }} />
                    Для специалистов
                  </span>
                ),
                children: (
                  <div className="stack" style={{ "--gap": "16px" } as React.CSSProperties}>
                    <span className="t-small">Только для просмотра. Эти параметры сервис настраивает сам.</span>
                    {model.directions.map((d) => (
                      <div key={d.id} className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
                        <span style={{ fontWeight: 600 }}>{d.name}</span>
                        <dl className="kv">
                          <dt>Площадка</dt>
                          <dd>{channelLabel(d.channel)}</dd>
                          <dt>Статус</dt>
                          <dd>{d.status === "active" ? "работает" : "на паузе"}</dd>
                          <dt>Стратегия</dt>
                          <dd>{d.strategy}</dd>
                          <dt>Недельный лимит</dt>
                          <dd>{formatRub(d.weeklyLimit)}</dd>
                          <dt>Расписание</dt>
                          <dd>{d.schedule || "—"}</dd>
                          <dt>Город</dt>
                          <dd>{d.city || "—"}</dd>
                        </dl>
                      </div>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
