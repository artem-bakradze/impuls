"use client";

import { DeleteOutlined, DownOutlined, PlusOutlined, UpOutlined } from "@ant-design/icons";
import { Button, Input, InputNumber, Select, Slider } from "antd";
import { useState } from "react";
import { DAY_OPTIONS, HOUR_OPTIONS, TIME_ZONES } from "@/lib/onboarding";
import type { OnboardingDraft } from "@/lib/onboarding";
import { Field } from "./Field";
import type { StepProps } from "./Wizard";

type Card = OnboardingDraft["card"];

const empty = (value: string) => value.trim().length === 0;

export function CardStep({ draft, onChange }: StepProps) {
  const card = draft.card;
  const set = (patch: Partial<Card>) => onChange({ ...draft, card: { ...card, ...patch } });
  const setService = (index: number, patch: Partial<Card["services"][number]>) =>
    set({ services: card.services.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const setAdvantage = (index: number, value: string) => set({ advantages: card.advantages.map((a, i) => (i === index ? value : a)) });
  const extrasFilled = !empty(card.phone) || !empty(card.typicalClient) || card.advantages.some((a) => !empty(a));
  const [extras, setExtras] = useState(extrasFilled);

  return (
    <div className="stack" style={{ "--gap": "0px" } as React.CSSProperties}>
      <div className="form-section">
        <h2 className="t-eyebrow">О бизнесе</h2>
        <div className="row" style={{ "--gap": "16px", alignItems: "flex-start" } as React.CSSProperties}>
          <div style={{ flex: "1 1 220px" }}>
            <Field label="Название" missing={empty(card.name)}>
              <Input value={card.name} onChange={(e) => set({ name: e.target.value })} placeholder="Например: Ноготок" aria-label="Название" maxLength={100} />
            </Field>
          </div>
          <div style={{ flex: "1 1 220px" }}>
            <Field label="Чем вы занимаетесь" missing={empty(card.category)}>
              <Input value={card.category} onChange={(e) => set({ category: e.target.value })} placeholder="Например: маникюрная студия" aria-label="Чем вы занимаетесь" maxLength={100} />
            </Field>
          </div>
        </div>
      </div>

      <div className="form-section">
        <h2 className="t-eyebrow">Услуги и цены</h2>
        <Field label="Что вы продаёте" missing={!card.services.some((s) => !empty(s.name))} help="Цены попадут в объявления: точная цена привлекает больше людей.">
          <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
            {card.services.map((service, index) => (
              <div key={index} className="row" style={{ "--gap": "8px", flexWrap: "nowrap" } as React.CSSProperties}>
                <Input style={{ flex: 1, minWidth: 0 }} value={service.name} onChange={(e) => setService(index, { name: e.target.value })} placeholder="Услуга" aria-label={`Услуга ${index + 1}`} maxLength={100} />
                <InputNumber
                  style={{ width: 132, flex: "none" }}
                  min={1}
                  value={service.priceRub}
                  onChange={(value) => setService(index, { priceRub: typeof value === "number" ? Math.round(value) : null })}
                  placeholder="Цена"
                  suffix="₽"
                  aria-label={`Цена услуги ${index + 1}`}
                  status={service.priceRub === null && !empty(service.name) ? "warning" : ""}
                />
                {card.services.length > 1 ? (
                  <Button type="text" icon={<DeleteOutlined aria-hidden="true" />} onClick={() => set({ services: card.services.filter((_, i) => i !== index) })} aria-label={`Убрать услугу ${index + 1}`} />
                ) : null}
              </div>
            ))}
            {card.services.some((s) => s.priceRub === null && !empty(s.name)) ? (
              <span className="missing" style={{ alignSelf: "flex-start" }}>
                Не нашли — заполните цены
              </span>
            ) : null}
            {card.services.length < 20 ? (
              <Button type="dashed" icon={<PlusOutlined aria-hidden="true" />} onClick={() => set({ services: [...card.services, { name: "", priceRub: null }] })} style={{ alignSelf: "flex-start" }}>
                Добавить услугу
              </Button>
            ) : null}
          </div>
        </Field>
      </div>

      <div className="form-section">
        <h2 className="t-eyebrow">Где и когда</h2>
        <Field label="Адрес" missing={empty(card.address)} help="Город и улица: по городу настраивается показ в Яндексе, а район мы упоминаем в объявлениях.">
          <Input value={card.address} onChange={(e) => set({ address: e.target.value })} placeholder="Москва, ул. Профсоюзная, 1" aria-label="Адрес" maxLength={200} />
        </Field>
        <Field label={`Откуда к вам приходят: до ${card.radiusKm} км`}>
          <Slider min={1} max={30} value={card.radiusKm} onChange={(value) => set({ radiusKm: value })} marks={{ 1: "1", 3: "3", 10: "10", 30: "30" }} tooltip={{ formatter: (v) => `${v ?? 0} км` }} aria-label="Радиус показа в километрах" />
        </Field>
        <Field label="Часы работы">
          <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
            <Select value={card.days} onChange={(days) => set({ days })} options={DAY_OPTIONS.map((d) => ({ value: d, label: d }))} style={{ width: 120 }} aria-label="Дни работы" />
            <Select value={card.openFrom} onChange={(openFrom) => set({ openFrom })} options={HOUR_OPTIONS.slice(0, 24).map((h) => ({ value: h, label: `с ${h}` }))} style={{ width: 112 }} aria-label="Открываетесь в" virtual={false} />
            <Select value={card.openTo} onChange={(openTo) => set({ openTo })} options={HOUR_OPTIONS.slice(1).map((h) => ({ value: h, label: `до ${h}` }))} style={{ width: 112 }} aria-label="Закрываетесь в" virtual={false} />
            <Select value={card.timeZone} onChange={(timeZone) => set({ timeZone })} options={TIME_ZONES.map((t) => ({ value: t.value, label: t.label }))} style={{ width: 230 }} aria-label="Часовой пояс" />
          </div>
        </Field>
      </div>

      <div className="form-section">
        <button
          type="button"
          onClick={() => setExtras(!extras)}
          aria-expanded={extras}
          className="row"
          style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", color: "var(--text)", justifyContent: "space-between", width: "100%" }}
        >
          <span className="stack" style={{ "--gap": "4px", textAlign: "left" } as React.CSSProperties}>
            <span className="t-h3">Подробности</span>
            <span className="t-small">Телефон, ваш клиент и преимущества — с ними объявления получаются точнее</span>
          </span>
          {extras ? <UpOutlined /> : <DownOutlined />}
        </button>
        {extras ? (
          <>
            <Field label="Телефон" missing={empty(card.phone)}>
              <Input value={card.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+7 900 000-00-00" aria-label="Телефон" inputMode="tel" maxLength={30} />
            </Field>
            <Field label="Кто ваш типичный клиент" missing={empty(card.typicalClient)}>
              <Input.TextArea value={card.typicalClient} onChange={(e) => set({ typicalClient: e.target.value })} autoSize={{ minRows: 2 }} maxLength={300} aria-label="Кто ваш типичный клиент" placeholder="Например: женщины 25–45 лет, живут или работают рядом" />
            </Field>
            <Field label="Чем вы лучше других" missing={card.advantages.every(empty)} help="1–3 коротких факта. Без «лучший» — такие слова запрещены законом о рекламе.">
              <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
                {card.advantages.map((advantage, index) => (
                  <Input key={index} value={advantage} onChange={(e) => setAdvantage(index, e.target.value)} aria-label={`Преимущество ${index + 1}`} maxLength={100} placeholder="Например: работаем без выходных" />
                ))}
                {card.advantages.length < 3 ? (
                  <Button type="dashed" icon={<PlusOutlined aria-hidden="true" />} onClick={() => set({ advantages: [...card.advantages, ""] })} style={{ alignSelf: "flex-start" }}>
                    Добавить пункт
                  </Button>
                ) : null}
              </div>
            </Field>
          </>
        ) : null}
      </div>
    </div>
  );
}
