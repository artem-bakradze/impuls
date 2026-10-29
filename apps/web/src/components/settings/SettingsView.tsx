"use client";

import {
  ClockCircleOutlined,
  CodeOutlined,
  EditOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  NotificationOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  ShopOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { Alert, Button, Collapse, Input, InputNumber, Radio, Select, Slider } from "antd";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";
import { callApi, PENDING_TEXT, runWebJob, runWebJobs } from "@/lib/client-api";
import type { CommandResult, JobOutcome } from "@/lib/client-api";
import { formatDateTime, formatRub, sentence } from "@/lib/format";
import { AD_TEXT_MAX, AD_TITLE_MAX, DAY_OPTIONS, HOUR_OPTIONS, MIN_BUDGET_RUB } from "@/lib/onboarding";
import { APPROVAL_WORDS, MODERATION_WORDS } from "@/lib/settings-model";
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

const SECTIONS = [
  { id: "business", label: "Что рекламируем", icon: <ShopOutlined /> },
  { id: "where", label: "Где и когда", icon: <EnvironmentOutlined /> },
  { id: "budget", label: "Бюджет и цель", icon: <WalletOutlined /> },
  { id: "ads", label: "Объявления", icon: <NotificationOutlined /> },
  { id: "site", label: "Сайт", icon: <GlobalOutlined /> },
  { id: "autopilot", label: "Автопилот", icon: <RobotOutlined /> },
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

export function SettingsView({ model }: { model: SettingsModel }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [radius, setRadius] = useState(model.radiusKm);
  const [days, setDays] = useState(model.schedule.days ?? DAY_OPTIONS[0]);
  const [from, setFrom] = useState(model.schedule.from ?? "10:00");
  const [to, setTo] = useState(model.schedule.to ?? "20:00");
  const [budget, setBudget] = useState<number | null>(model.monthlyBudgetRub);
  const [adEdits, setAdEdits] = useState<Record<string, { title: string; text: string }>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [autonomy, setAutonomy] = useState(model.autonomy);

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

  const saveAutonomy = async (value: "auto" | "ask") => {
    setAutonomy(value);
    const result = await callApi("/api/settings/autonomy", "PUT", { autonomy: value });
    setFeedback(result.kind === "ok" ? { section: "autonomy", type: "success", text: "Сохранено" } : { section: "autonomy", type: "error", text: result.message });
  };

  const decide = async (approvalId: string, approve: boolean) => {
    setBusy(approvalId);
    const outcome = await runWebJob("/api/approvals", { approvalId, approve });
    done(
      outcome.kind === "done"
        ? { section: "approvals", type: "success", text: approve ? "Готово — применяем изменение" : "Хорошо, не будем этого делать" }
        : outcome.kind === "pending"
          ? { section: "approvals", type: "info", text: PENDING_TEXT }
          : { section: "approvals", type: "error", text: outcome.message },
    );
  };

  const schedule = `${days} ${from}–${to}`;

  return (
    <div className="page">
      <PageHead
        title="Настройки"
        lead="Меняйте простым языком — сервис сам перенесёт изменения в Яндекс Директ за несколько минут."
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
          <Section id="business" title="Что рекламируем" lead="Из карточки, которую вы подтвердили при запуске">
            <dl className="kv">
              <dt>Чем занимаетесь</dt>
              <dd>{model.card.category}</dd>
              <dt>Услуги</dt>
              <dd>{model.card.services.map((s) => (s.priceRub === null ? s.name : `${s.name} — ${formatRub(s.priceRub * 100)}`)).join("; ")}</dd>
              <dt>Преимущества</dt>
              <dd>{model.card.advantages.join("; ") || "не указаны"}</dd>
            </dl>
          </Section>

          <Section id="where" title="Где и когда" lead="Показ в Яндексе настраивается по городу; радиус помогает писать объявления про ваш район">
            <div className="stack" style={{ "--gap": "22px" } as React.CSSProperties}>
              <div className="field">
                <div className="field-label">
                  <EnvironmentOutlined />
                  Откуда к вам приходят: до {radius} км
                </div>
                <Slider min={1} max={30} value={radius} onChange={setRadius} marks={{ 1: "1", 3: "3", 10: "10", 30: "30" }} tooltip={{ formatter: (v) => `${v ?? 0} км` }} aria-label="Радиус показа в километрах" />
                {radius !== model.radiusKm ? (
                  <Button type="primary" loading={busy === "geo"} onClick={() => void commands("geo", { action: "geo", radiusKm: radius }, "Зона показа обновлена")} style={{ alignSelf: "flex-start" }}>
                    Сохранить зону
                  </Button>
                ) : null}
                <SectionFeedback feedback={feedback} section="geo" />
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
                  <Button
                    type="primary"
                    disabled={schedule === model.schedule.raw || from >= to}
                    loading={busy === "schedule"}
                    onClick={() => void commands("schedule", { action: "schedule", schedule }, "Расписание показов обновлено во всех кампаниях")}
                  >
                    Сохранить время
                  </Button>
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
                  <Button type="primary" disabled={budget === null || budget < MIN_BUDGET_RUB || budget === model.monthlyBudgetRub} loading={busy === "budget"} onClick={() => budget !== null && void saveBudget(budget, false)}>
                    Сохранить бюджет
                  </Button>
                </div>
              </div>
              <div className="note">
                <span>
                  Цель: {model.goal.mode === "user" ? `до ${formatRub(model.goal.rub * 100)} за обращение` : `подбирать автоматически (сейчас до ${formatRub(model.goal.rub * 100)} за обращение)`}
                </span>
              </div>
            </div>
            <SectionFeedback feedback={feedback} section="budget" onConfirmBudget={(amount) => void saveBudget(amount, true)} />
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
              <span className="t-body">
                Объявления ведут на ваш сайт:{" "}
                <a href={model.siteUrl} target="_blank" rel="noreferrer">
                  {model.siteUrl}
                </a>
              </span>
            ) : (
              // Launch requires the owner's site; the mini-site form is out of the MVP (replace-direct-sandbox decision 7).
              <span className="t-small">Адрес сайта не указан</span>
            )}
          </Section>

          <Section id="autopilot" title="Автопилот" lead="Насколько самостоятельно действовать">
            <Radio.Group
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
              value={autonomy}
              onChange={(e) => void saveAutonomy(e.target.value as "auto" | "ask")}
              options={[
                { value: "auto", label: "Действовать самостоятельно — все улучшения применяются сразу" },
                { value: "ask", label: "Спрашивать перед крупными изменениями — перенос больше 30% бюджета, остановка направления, запуск проверки" },
              ]}
            />
            <p className="t-small" style={{ marginTop: 12 }}>
              Защита бюджета работает всегда и без вопросов: мы никогда не потратим больше, чем вы указали. Запрос без ответа истекает через 48 часов.
            </p>
            <SectionFeedback feedback={feedback} section="autonomy" />
            <hr className="divider" style={{ margin: "18px 0" }} />
            <div className="field-label" style={{ marginBottom: 6 }}>
              Запросы на подтверждение
            </div>
            {model.approvals.length === 0 ? <span className="t-small">Запросов пока не было.</span> : null}
            {model.approvals.map((a) => (
              <div key={a.id} className="list-row">
                <div className="stack" style={{ "--gap": "4px", flex: 1 } as React.CSSProperties}>
                  <span className="t-body">{a.explanation}</span>
                  <span className="t-small">
                    {APPROVAL_WORDS[a.status]} · {formatDateTime(a.at, model.timeZone)}
                  </span>
                </div>
                {a.status === "pending" ? (
                  <div className="row" style={{ "--gap": "6px" } as React.CSSProperties}>
                    <Button type="primary" size="small" loading={busy === a.id} onClick={() => void decide(a.id, true)}>
                      Согласен
                    </Button>
                    <Button size="small" disabled={busy === a.id} onClick={() => void decide(a.id, false)}>
                      Не надо
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
            <SectionFeedback feedback={feedback} section="approvals" />
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
                          <dt>Радиус</dt>
                          <dd>{d.radiusKm} км</dd>
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
