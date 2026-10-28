"use client";

import { Alert, Button, Card, Collapse, Descriptions, Flex, Input, InputNumber, List, Radio, Select, Slider, Space, Tag, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, PENDING_TEXT, runWebJob, runWebJobs } from "@/lib/client-api";
import type { CommandResult, JobOutcome } from "@/lib/client-api";
import { formatDateTime, formatRub, sentence } from "@/lib/format";
import { AD_TEXT_MAX, AD_TITLE_MAX, DAY_OPTIONS, HOUR_OPTIONS, MIN_BUDGET_RUB } from "@/lib/onboarding";
import { APPROVAL_WORDS, MODERATION_WORDS } from "@/lib/settings-model";
import type { SettingsModel } from "@/lib/settings-model";
import { channelLabel } from "@/lib/summary-model";

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
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Title level={2} style={{ margin: 0 }}>
          Настройки
        </Typography.Title>
        {model.paused ? (
          <Button type="primary" onClick={() => void commands("pause", { action: "resumeAll" }, "Реклама снова работает")} loading={busy === "pause"}>
            Возобновить рекламу
          </Button>
        ) : (
          <Button danger onClick={() => void commands("pause", { action: "pauseAll" }, "Реклама на паузе. Пока она стоит, сервис ничего не меняет")} loading={busy === "pause"}>
            Поставить рекламу на паузу
          </Button>
        )}
      </Flex>
      <SectionFeedback feedback={feedback} section="pause" />
      {model.paused ? <Alert type="warning" showIcon title="Реклама на паузе" /> : null}

      <Card title="Что рекламируем" size="small">
        <Descriptions
          column={1}
          size="small"
          items={[
            { key: "category", label: "Чем занимаетесь", children: model.card.category },
            { key: "services", label: "Услуги", children: model.card.services.map((s) => (s.priceRub === null ? s.name : `${s.name} — ${formatRub(s.priceRub * 100)}`)).join("; ") },
            { key: "advantages", label: "Преимущества", children: model.card.advantages.join("; ") || "не указаны" },
          ]}
        />
        <Typography.Text type="secondary">Изменить услуги и цены можно будет в следующей версии.</Typography.Text>
      </Card>

      <Card title="Где показываем" size="small">
        <Typography.Text>До {radius} км от вашего адреса</Typography.Text>
        <Slider min={1} max={30} value={radius} onChange={setRadius} marks={{ 1: "1 км", 3: "3", 10: "10", 30: "30 км" }} aria-label="Радиус показа в километрах" />
        <Button type="primary" disabled={radius === model.radiusKm} loading={busy === "geo"} onClick={() => void commands("geo", { action: "geo", radiusKm: radius }, "Зона показа обновлена")}>
          Сохранить зону
        </Button>
        <SectionFeedback feedback={feedback} section="geo" />
      </Card>

      <Card title="Когда показываем" size="small" data-testid="schedule-section">
        <Typography.Paragraph>Сейчас: {model.schedule.raw || "не задано"}</Typography.Paragraph>
        <Flex gap={8} wrap>
          <Select value={days} onChange={setDays} options={DAY_OPTIONS.map((d) => ({ value: d, label: d }))} style={{ width: 120 }} aria-label="Дни показа" />
          <Select value={from} onChange={setFrom} options={HOUR_OPTIONS.slice(0, 24).map((h) => ({ value: h, label: `с ${h}` }))} style={{ width: 110 }} aria-label="Показывать с" virtual={false} />
          <Select value={to} onChange={setTo} options={HOUR_OPTIONS.slice(1).map((h) => ({ value: h, label: `до ${h}` }))} style={{ width: 110 }} aria-label="Показывать до" virtual={false} />
        </Flex>
        <Button
          style={{ marginTop: 12 }}
          type="primary"
          disabled={schedule === model.schedule.raw || from >= to}
          loading={busy === "schedule"}
          onClick={() => void commands("schedule", { action: "schedule", schedule }, "Расписание показов обновлено во всех кампаниях")}
        >
          Сохранить время
        </Button>
        <SectionFeedback feedback={feedback} section="schedule" />
      </Card>

      <Card title="Бюджет и цель" size="small">
        <Flex vertical gap={8}>
          <Typography.Text>Сколько тратить в месяц, с НДС:</Typography.Text>
          <Space wrap>
            <InputNumber min={MIN_BUDGET_RUB} step={1000} value={budget} onChange={(v) => setBudget(typeof v === "number" ? Math.round(v) : null)} suffix="₽" aria-label="Бюджет в месяц" style={{ width: 180 }} />
            <Button type="primary" disabled={budget === null || budget < MIN_BUDGET_RUB || budget === model.monthlyBudgetRub} loading={busy === "budget"} onClick={() => budget !== null && void saveBudget(budget, false)}>
              Сохранить бюджет
            </Button>
          </Space>
          <Typography.Text>
            Цель: {model.goal.mode === "user" ? `до ${formatRub(model.goal.rub * 100)} за обращение` : `подбирать автоматически (сейчас до ${formatRub(model.goal.rub * 100)} за обращение)`}
          </Typography.Text>
          <Typography.Text type="secondary">Изменить цель можно будет в следующей версии.</Typography.Text>
        </Flex>
        <SectionFeedback feedback={feedback} section="budget" onConfirmBudget={(amount) => void saveBudget(amount, true)} />
      </Card>

      <Card title="Объявления" size="small">
        <List
          dataSource={model.ads}
          renderItem={(ad) => {
            const edit = adEdits[ad.id] ?? { title: ad.title, text: ad.text };
            const changed = edit.title !== ad.title || edit.text !== ad.text;
            return (
              <List.Item>
                <Flex vertical gap={6} style={{ width: "100%" }}>
                  <Space wrap>
                    <Tag color={ad.status === "active" ? "green" : "default"}>{ad.status === "active" ? "Показывается" : "Отключено"}</Tag>
                    <Tag color={ad.moderation === "rejected" ? "red" : ad.moderation === "pending" ? "processing" : "green"}>{MODERATION_WORDS[ad.moderation]}</Tag>
                    <Typography.Text type="secondary">{ad.direction}</Typography.Text>
                  </Space>
                  <Input value={edit.title} maxLength={AD_TITLE_MAX} showCount onChange={(e) => setAdEdits({ ...adEdits, [ad.id]: { ...edit, title: e.target.value } })} aria-label="Заголовок объявления" />
                  <Input.TextArea value={edit.text} maxLength={AD_TEXT_MAX} showCount autoSize onChange={(e) => setAdEdits({ ...adEdits, [ad.id]: { ...edit, text: e.target.value } })} aria-label="Текст объявления" />
                  <Space wrap>
                    <Button disabled={!changed} loading={busy === `text-${ad.id}`} onClick={() => void commands(`text-${ad.id}`, { action: "adText", adId: ad.id, ...edit }, "Текст изменён — Яндекс проверит объявление заново")}>
                      Сохранить текст
                    </Button>
                    <Button loading={busy === `status-${ad.id}`} onClick={() => void commands(`status-${ad.id}`, { action: "adStatus", adId: ad.id, active: ad.status !== "active" }, ad.status === "active" ? "Объявление отключено" : "Объявление включено")}>
                      {ad.status === "active" ? "Отключить" : "Включить"}
                    </Button>
                  </Space>
                  <SectionFeedback feedback={feedback} section={`text-${ad.id}`} />
                  <SectionFeedback feedback={feedback} section={`status-${ad.id}`} />
                </Flex>
              </List.Item>
            );
          }}
        />
      </Card>

      <Card title="Сайт" size="small">
        {model.siteUrl ? (
          <Typography.Text>
            Объявления ведут на ваш сайт:{" "}
            <a href={model.siteUrl} target="_blank" rel="noreferrer">
              {model.siteUrl}
            </a>
          </Typography.Text>
        ) : (
          <Typography.Text>Своего сайта нет. Мини-сайт для вашего бизнеса появится в следующей версии.</Typography.Text>
        )}
      </Card>

      <Card title="Насколько самостоятельно действовать" size="small">
        <Radio.Group
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
          value={autonomy}
          onChange={(e) => void saveAutonomy(e.target.value as "auto" | "ask")}
          options={[
            { value: "auto", label: "Действовать самостоятельно — все улучшения применяются сразу" },
            { value: "ask", label: "Спрашивать перед крупными изменениями — перенос больше 30% бюджета, остановка направления, запуск проверки" },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          Защита бюджета работает всегда и без вопросов: мы никогда не потратим больше, чем вы указали. Запрос без ответа истекает через 48 часов.
        </Typography.Paragraph>
        <SectionFeedback feedback={feedback} section="autonomy" />
      </Card>

      <Card title="Запросы на подтверждение" size="small">
        {model.approvals.length === 0 ? (
          <Typography.Text type="secondary">Запросов пока не было.</Typography.Text>
        ) : (
          <List
            dataSource={model.approvals}
            renderItem={(a) => (
              <List.Item
                actions={
                  a.status === "pending"
                    ? [
                        <Button key="yes" type="primary" size="small" loading={busy === a.id} onClick={() => void decide(a.id, true)}>
                          Согласен
                        </Button>,
                        <Button key="no" size="small" disabled={busy === a.id} onClick={() => void decide(a.id, false)}>
                          Не надо
                        </Button>,
                      ]
                    : []
                }
              >
                <List.Item.Meta title={a.explanation} description={`${APPROVAL_WORDS[a.status]} · ${formatDateTime(a.at, model.timeZone)}`} />
              </List.Item>
            )}
          />
        )}
        <SectionFeedback feedback={feedback} section="approvals" />
      </Card>

      <Collapse
        items={[
          {
            key: "pro",
            label: "Для специалистов",
            children: (
              <Flex vertical gap={8}>
                <Typography.Text type="secondary">Только для просмотра. Эти параметры сервис настраивает сам.</Typography.Text>
                {model.directions.map((d) => (
                  <Descriptions
                    key={d.id}
                    title={d.name}
                    size="small"
                    column={1}
                    bordered
                    items={[
                      { key: "channel", label: "Площадка", children: channelLabel(d.channel) },
                      { key: "status", label: "Статус", children: d.status === "active" ? "работает" : "на паузе" },
                      { key: "strategy", label: "Стратегия", children: d.strategy },
                      { key: "limit", label: "Недельный лимит", children: formatRub(d.weeklyLimit) },
                      { key: "schedule", label: "Расписание", children: d.schedule || "—" },
                      { key: "geo", label: "Радиус", children: `${d.radiusKm} км` },
                      { key: "phrases", label: "Ключевые и минус-фразы", children: "пока не задаются в этой версии" },
                    ]}
                  />
                ))}
              </Flex>
            ),
          },
        ]}
      />
    </Flex>
  );
}
