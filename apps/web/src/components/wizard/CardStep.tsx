"use client";

import { Alert, Button, Flex, Input, InputNumber, Select, Slider, Typography } from "antd";
import type { ReactNode } from "react";
import { DAY_OPTIONS, hasOwnSite, HOUR_OPTIONS, TIME_ZONES } from "@/lib/onboarding";
import type { OnboardingDraft } from "@/lib/onboarding";
import { Missing } from "./Missing";
import type { StepProps } from "./Wizard";

type Card = OnboardingDraft["card"];

function Field({ label, missing, children }: { label: string; missing?: boolean; children: ReactNode }) {
  return (
    <div>
      <Typography.Text strong>{label}</Typography.Text>
      <Missing show={missing ?? false} />
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

const empty = (value: string) => value.trim().length === 0;

export function CardStep({ draft, onChange }: StepProps) {
  const card = draft.card;
  const set = (patch: Partial<Card>) => onChange({ ...draft, card: { ...card, ...patch } });
  const setService = (index: number, patch: Partial<Card["services"][number]>) =>
    set({ services: card.services.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const setAdvantage = (index: number, value: string) => set({ advantages: card.advantages.map((a, i) => (i === index ? value : a)) });

  return (
    <Flex vertical gap={16}>
      <Typography.Paragraph style={{ margin: 0 }}>
        Проверьте карточку — по ней мы соберём объявления. Что не заполнено, мы не придумываем: заполните сами.
      </Typography.Paragraph>
      <Field label="Название" missing={empty(card.name)}>
        <Input value={card.name} onChange={(e) => set({ name: e.target.value })} aria-label="Название" maxLength={100} />
      </Field>
      <Field label="Чем вы занимаетесь" missing={empty(card.category)}>
        <Input value={card.category} onChange={(e) => set({ category: e.target.value })} placeholder="Например: маникюр" aria-label="Чем вы занимаетесь" maxLength={100} />
      </Field>
      <Field label="Услуги и цены" missing={!card.services.some((s) => !empty(s.name))}>
        <Flex vertical gap={8}>
          {card.services.map((service, index) => (
            <Flex key={index} gap={8} wrap align="center">
              <Input
                style={{ flex: "1 1 180px" }}
                value={service.name}
                onChange={(e) => setService(index, { name: e.target.value })}
                placeholder="Услуга"
                aria-label={`Услуга ${index + 1}`}
                maxLength={100}
              />
              <InputNumber
                style={{ width: 140 }}
                min={1}
                value={service.priceRub}
                onChange={(value) => setService(index, { priceRub: typeof value === "number" ? Math.round(value) : null })}
                placeholder="Цена"
                suffix="₽"
                aria-label={`Цена услуги ${index + 1}`}
              />
              {service.priceRub === null ? <Missing show /> : null}
              {card.services.length > 1 ? (
                <Button type="text" onClick={() => set({ services: card.services.filter((_, i) => i !== index) })} aria-label={`Убрать услугу ${index + 1}`}>
                  Убрать
                </Button>
              ) : null}
            </Flex>
          ))}
          {card.services.length < 20 ? (
            <Button onClick={() => set({ services: [...card.services, { name: "", priceRub: null }] })} style={{ alignSelf: "flex-start" }}>
              Добавить услугу
            </Button>
          ) : null}
        </Flex>
      </Field>
      <Field label="Адрес" missing={empty(card.address)}>
        <Input value={card.address} onChange={(e) => set({ address: e.target.value })} placeholder="Город, улица, дом" aria-label="Адрес" maxLength={200} />
      </Field>
      <Field label={`Где показывать рекламу: до ${card.radiusKm} км от адреса`}>
        <Slider min={1} max={30} value={card.radiusKm} onChange={(value) => set({ radiusKm: value })} marks={{ 1: "1 км", 3: "3", 10: "10", 30: "30 км" }} aria-label="Радиус показа в километрах" />
        <Typography.Text type="secondary">Рекламу увидят люди, которые находятся в этом круге вокруг вашего адреса.</Typography.Text>
      </Field>
      <Field label="Часы работы">
        <Flex gap={8} wrap>
          <Select value={card.days} onChange={(days) => set({ days })} options={DAY_OPTIONS.map((d) => ({ value: d, label: d }))} style={{ width: 120 }} aria-label="Дни работы" />
          <Select value={card.openFrom} onChange={(openFrom) => set({ openFrom })} options={HOUR_OPTIONS.slice(0, 24).map((h) => ({ value: h, label: `с ${h}` }))} style={{ width: 110 }} aria-label="Открываетесь в" virtual={false} />
          <Select value={card.openTo} onChange={(openTo) => set({ openTo })} options={HOUR_OPTIONS.slice(1).map((h) => ({ value: h, label: `до ${h}` }))} style={{ width: 110 }} aria-label="Закрываетесь в" virtual={false} />
        </Flex>
      </Field>
      <Field label="Телефон" missing={empty(card.phone)}>
        <Input value={card.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+7 ..." aria-label="Телефон" inputMode="tel" maxLength={30} />
      </Field>
      <Field label="Кто ваш типичный клиент" missing={empty(card.typicalClient)}>
        <Input.TextArea value={card.typicalClient} onChange={(e) => set({ typicalClient: e.target.value })} autoSize={{ minRows: 2 }} maxLength={300} aria-label="Кто ваш типичный клиент" placeholder="Например: женщины 25–45 лет, живут или работают рядом" />
      </Field>
      <Field label="Чем вы лучше других (1–3 пункта)" missing={card.advantages.every(empty)}>
        <Flex vertical gap={8}>
          {card.advantages.map((advantage, index) => (
            <Input key={index} value={advantage} onChange={(e) => setAdvantage(index, e.target.value)} aria-label={`Преимущество ${index + 1}`} maxLength={100} placeholder="Например: работаем без выходных" />
          ))}
          {card.advantages.length < 3 ? (
            <Button onClick={() => set({ advantages: [...card.advantages, ""] })} style={{ alignSelf: "flex-start" }}>
              Добавить пункт
            </Button>
          ) : null}
        </Flex>
      </Field>
      <Field label="Часовой пояс">
        <Select value={card.timeZone} onChange={(timeZone) => set({ timeZone })} options={TIME_ZONES.map((t) => ({ value: t.value, label: t.label }))} style={{ width: 260 }} aria-label="Часовой пояс" />
      </Field>
      {!hasOwnSite(draft) ? (
        <Alert
          type="info"
          showIcon
          title="Своего сайта нет — это не страшно"
          description="Для таких случаев мы готовим мини-сайт с вашими услугами и кнопками «Позвонить» и «Написать». В этой версии он ещё недоступен."
        />
      ) : null}
    </Flex>
  );
}
