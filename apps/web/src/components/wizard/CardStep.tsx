"use client";

import { DeleteOutlined, DownOutlined, PlusOutlined, UpOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Input, InputNumber, Select } from "antd";
import { useState } from "react";
import { ALL_DAY, cardMostlyEmpty, cityOf, DAY_OPTIONS, HOUR_OPTIONS, TIME_ZONES, timeZoneLabel, timeZoneOf } from "@/lib/onboarding";
import type { OnboardingDraft } from "@/lib/onboarding";
import { Note } from "../ui/primitives";
import { Field } from "./Field";
import type { StepProps } from "./Wizard";

type Card = OnboardingDraft["card"];

const empty = (value: string) => value.trim().length === 0;

export function CardStep({ draft, onChange, errors = {} }: StepProps) {
  const card = draft.card;
  /** Decided once per visit: when the sources gave almost nothing, one notice replaces a mark at every optional field. */
  const [sparse] = useState(() => cardMostlyEmpty(card));
  const optionalMissing = (value: string) => !sparse && empty(value);
  const priceMissing = card.services.some((s) => s.priceRub === null && !empty(s.name));
  const set = (patch: Partial<Card>) => onChange({ ...draft, card: { ...card, ...patch } });
  const setService = (index: number, patch: Partial<Card["services"][number]>) =>
    set({ services: card.services.map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  const setAdvantage = (index: number, value: string) => set({ advantages: card.advantages.map((a, i) => (i === index ? value : a)) });
  const [extras, setExtras] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  const allDay = card.openFrom === ALL_DAY.openFrom && card.openTo === ALL_DAY.openTo;
  /** The city decides the time zone, unless the owner picked one by hand. */
  const setCity = (city: string, address = card.address) =>
    set({ address, city, ...(zoneOpen ? {} : { timeZone: timeZoneOf(city) }) });

  return (
    <div className="stack" style={{ "--gap": "0px" } as React.CSSProperties}>
      {sparse ? (
        <div style={{ marginBottom: 22 }}>
          <Note tone="warning" icon={<WarningOutlined aria-hidden="true" />} data-testid="card-sparse">
            С сайта почти ничего не получилось прочитать — заполните услугу и город, остальное по желанию.
          </Note>
        </div>
      ) : null}
      <div className="form-section">
        <h2 className="t-eyebrow">Услуги и цены</h2>
        <Field id="services" label="Что вы продаёте" error={errors.services} missing={!card.services.some((s) => !empty(s.name))} help={priceMissing ? undefined : "Цены необязательны, но точная цена в объявлении привлекает больше людей."}>
          <div className="stack" style={{ "--gap": "8px" } as React.CSSProperties}>
            {card.services.map((service, index) => (
              <div key={index} className="row" style={{ "--gap": "8px", flexWrap: "nowrap" } as React.CSSProperties}>
                <Input style={{ flex: 1, minWidth: 0 }} value={service.name} onChange={(e) => setService(index, { name: e.target.value })} placeholder="Услуга" aria-label={`Услуга ${index + 1}`} maxLength={100} />
                <InputNumber
                  className="optional-input"
                  style={{ width: 132, flex: "none" }}
                  min={1}
                  value={service.priceRub}
                  onChange={(value) => setService(index, { priceRub: typeof value === "number" ? Math.round(value) : null })}
                  placeholder="Цена"
                  suffix="₽"
                  aria-label={`Цена услуги ${index + 1}`}
                />
                {card.services.length > 1 ? (
                  <Button type="text" icon={<DeleteOutlined aria-hidden="true" />} onClick={() => set({ services: card.services.filter((_, i) => i !== index) })} aria-label={`Убрать услугу ${index + 1}`} />
                ) : null}
              </div>
            ))}
            {priceMissing ? (
              <span className="missing missing-optional" style={{ alignSelf: "flex-start" }}>
                Цены не нашли — можно дописать
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
        <Field id="city" label="Город" error={errors.city} missing={empty(card.city)} help="Реклама будет показываться людям в этом городе.">
          <Input value={card.city} onChange={(e) => setCity(e.target.value)} placeholder="Москва" aria-label="Город" maxLength={100} style={{ maxWidth: 320 }} />
        </Field>
        <button type="button" className="link-button" aria-expanded={extras || Boolean(errors.hours)} onClick={() => setExtras(!extras)}>
          {extras ? <UpOutlined aria-hidden="true" /> : <DownOutlined aria-hidden="true" />} Дополнительные сведения
        </button>
        <p className="t-small">Название, адрес, часы работы и преимущества — проверьте, если нужно уточнить объявления.</p>
        {extras || errors.hours ? <>
        <Field label="Название" missing={optionalMissing(card.name)} optional>
          <Input value={card.name} onChange={(e) => set({ name: e.target.value })} placeholder="Например: Ноготок" aria-label="Название" maxLength={100} />
        </Field>
        <Field label="Чем вы занимаетесь" missing={optionalMissing(card.category)} optional>
          <Input value={card.category} onChange={(e) => set({ category: e.target.value })} placeholder="Например: маникюрная студия" aria-label="Чем вы занимаетесь" maxLength={100} />
        </Field>
        <Field label="Адрес" missing={optionalMissing(card.address)} optional help="Работаете на выезде или онлайн — оставьте пустым.">
          <Input value={card.address} onChange={(e) => {
            const address = e.target.value;
            if (card.city === "" || card.city === cityOf(card.address)) setCity(cityOf(address), address);
            else set({ address });
          }} placeholder="Москва, ул. Профсоюзная, 1" aria-label="Адрес" maxLength={200} />
        </Field>
        <Field id="hours" label="Часы работы" error={errors.hours} help={card.openTo < card.openFrom && !allDay ? "Закрываетесь после полуночи — так и покажем рекламу." : undefined}>
          <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
            {/* Narrow enough for one line on a phone; «Круглосуточно» may wrap below. */}
            <div className="row" style={{ "--gap": "8px", flexWrap: "wrap" } as React.CSSProperties}>
              <Select value={card.days} onChange={(days) => set({ days })} options={DAY_OPTIONS.map((d) => ({ value: d, label: d }))} style={{ width: 96 }} aria-label="Дни работы" />
              {allDay ? null : (
                <>
                  <Select value={card.openFrom} onChange={(openFrom) => set({ openFrom })} options={HOUR_OPTIONS.slice(0, 24).map((h) => ({ value: h, label: `с ${h}` }))} style={{ width: 108 }} aria-label="Открываетесь в" virtual={false} />
                  <Select value={card.openTo} onChange={(openTo) => set({ openTo })} options={HOUR_OPTIONS.slice(1).map((h) => ({ value: h, label: `до ${h}` }))} style={{ width: 108 }} aria-label="Закрываетесь в" virtual={false} />
                </>
              )}
            </div>
            <button type="button" className="preset" role="switch" aria-checked={allDay} aria-pressed={allDay} onClick={() => set(allDay ? { openFrom: "10:00", openTo: "20:00" } : { ...ALL_DAY })}>
              Круглосуточно
            </button>
          </div>
        </Field>
        <div className="t-small" data-testid="time-zone">
          Часовой пояс: {timeZoneLabel(card.timeZone)}
          {zoneOpen ? null : (
            <>
              {" · "}
              <button type="button" className="link-button" onClick={() => setZoneOpen(true)}>
                изменить
              </button>
            </>
          )}
        </div>
        {zoneOpen ? (
          <Select value={card.timeZone} onChange={(timeZone) => set({ timeZone })} options={TIME_ZONES.map((t) => ({ value: t.value, label: t.label }))} style={{ width: 260 }} aria-label="Часовой пояс" />
        ) : null}
        </> : null}
      </div>

      <div className="form-section">
        {extras ? (
          <>
            <Field label="Телефон" missing={optionalMissing(card.phone)} optional>
              <Input value={card.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+7 900 000-00-00" aria-label="Телефон" inputMode="tel" maxLength={30} />
            </Field>
            <Field label="Кто ваш типичный клиент" missing={optionalMissing(card.typicalClient)} optional>
              <Input.TextArea value={card.typicalClient} onChange={(e) => set({ typicalClient: e.target.value })} autoSize={{ minRows: 2 }} maxLength={300} aria-label="Кто ваш типичный клиент" placeholder="Например: женщины 25–45 лет, живут или работают рядом" />
            </Field>
            <Field label="Чем вы лучше других" missing={!sparse && card.advantages.every(empty)} optional help="1–3 коротких факта. Без «лучший» — такие слова запрещены законом о рекламе.">
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
