"use client";

import { Alert, Button, Flex, Input, InputNumber, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PENDING_TEXT, runWebJob } from "@/lib/client-api";
import type { CommandResult } from "@/lib/client-api";
import type { SettingsModel } from "@/lib/settings-model";

type Feedback = { type: "success" | "error" | "info"; text: string } | null;

/** «Сайт» for a business without its own site: create or edit the mini-site (published within a minute). */
export function MiniSiteForm({ initial }: { initial: SettingsModel["miniSite"] }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm({ ...form, [key]: value });

  const save = async () => {
    setBusy(true);
    setFeedback(null);
    const outcome = await runWebJob<CommandResult>("/api/minisite", form);
    setBusy(false);
    if (outcome.kind === "error") {
      setFeedback({ type: "error", text: outcome.message });
    } else if (outcome.kind === "pending") {
      setFeedback({ type: "info", text: PENDING_TEXT });
    } else if (outcome.output.status === "applied" || outcome.output.status === "clamped") {
      setFeedback({ type: "success", text: "Мини-сайт опубликован. Изменения уже видны посетителям." });
      setForm({ ...form, published: true });
      router.refresh();
    } else {
      setFeedback({ type: "error", text: outcome.output.message });
    }
  };

  return (
    <Flex vertical gap={8} data-testid="minisite-form">
      <Typography.Text>
        {form.published ? "Ваш мини-сайт работает. Здесь можно поменять тексты, цены и контакты." : "Своего сайта нет — сделаем мини-сайт, на который будут вести объявления."}
      </Typography.Text>
      <Input addonBefore="Адрес страницы" aria-label="Адрес мини-сайта" value={form.slug} disabled={form.published} onChange={(e) => set("slug", e.target.value.toLowerCase())} />
      <Input aria-label="Название на сайте" placeholder="Название" value={form.businessName} onChange={(e) => set("businessName", e.target.value)} />
      <Input aria-label="Телефон на сайте" placeholder="Телефон" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
      <Input aria-label="Адрес на сайте" placeholder="Адрес" value={form.address} onChange={(e) => set("address", e.target.value)} />
      <Input aria-label="Часы работы на сайте" placeholder="Пн–Вс 10:00–20:00" value={form.hours} onChange={(e) => set("hours", e.target.value)} />
      <Input aria-label="Telegram на сайте" placeholder="Telegram, необязательно" value={form.telegram} onChange={(e) => set("telegram", e.target.value)} />
      {form.services.map((service, index) => (
        <Flex key={index} gap={8}>
          <Input aria-label={`Услуга на сайте ${index + 1}`} value={service.name} onChange={(e) => set("services", form.services.map((s, i) => (i === index ? { ...s, name: e.target.value } : s)))} />
          <InputNumber
            aria-label={`Цена на сайте ${index + 1}`}
            min={1}
            addonAfter="₽"
            value={service.priceRub}
            onChange={(value) => set("services", form.services.map((s, i) => (i === index ? { ...s, priceRub: Number(value ?? 0) } : s)))}
          />
        </Flex>
      ))}
      <InputNumber aria-label="Номер счётчика Метрики" placeholder="Номер счётчика Метрики" style={{ width: "100%" }} value={form.metrikaCounterId} onChange={(value) => set("metrikaCounterId", value === null ? null : Number(value))} />
      <Input aria-label="Рекламодатель" placeholder="Рекламодатель: ИП или ООО" value={form.advertiserName} onChange={(e) => set("advertiserName", e.target.value)} />
      <Input aria-label="ИНН рекламодателя" placeholder="ИНН" value={form.advertiserInn} onChange={(e) => set("advertiserInn", e.target.value)} />
      <Button type="primary" loading={busy} onClick={() => void save()}>
        {form.published ? "Сохранить мини-сайт" : "Опубликовать мини-сайт"}
      </Button>
      {feedback ? <Alert type={feedback.type} message={feedback.text} showIcon /> : null}
    </Flex>
  );
}
