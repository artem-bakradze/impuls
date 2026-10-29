"use client";

import { EnvironmentOutlined, GlobalOutlined, TeamOutlined } from "@ant-design/icons";
import { Input } from "antd";
import { ABOUT_MAX_LENGTH } from "@/lib/onboarding";
import { Field } from "./Field";
import type { StepProps } from "./Wizard";

export function SourcesStep({ draft, onChange }: StepProps) {
  const set = (patch: Partial<StepProps["draft"]["sources"]>) => onChange({ ...draft, sources: { ...draft.sources, ...patch } });
  return (
    <div className="form-section">
      <Field label="Ваш сайт" help="На эту страницу будут вести объявления. Мы прочитаем её и сами заполним карточку бизнеса.">
        <Input
          size="large"
          prefix={<GlobalOutlined style={{ color: "var(--text-3)" }} />}
          value={draft.sources.siteUrl}
          onChange={(e) => set({ siteUrl: e.target.value.trim() })}
          placeholder="https://ваш-сайт.ru"
          aria-label="Ваш сайт"
          inputMode="url"
          autoFocus
        />
      </Field>
      <div className="row" style={{ "--gap": "16px", alignItems: "flex-start" } as React.CSSProperties}>
        <div style={{ flex: "1 1 240px" }}>
          <Field label="Яндекс Карты">
            <Input
              prefix={<EnvironmentOutlined style={{ color: "var(--text-3)" }} />}
              value={draft.sources.mapsUrl}
              onChange={(e) => set({ mapsUrl: e.target.value.trim() })}
              placeholder="https://yandex.ru/maps/org/…"
              aria-label="Организация в Яндекс Картах"
              inputMode="url"
            />
          </Field>
        </div>
        <div style={{ flex: "1 1 240px" }}>
          <Field label="ВКонтакте">
            <Input
              prefix={<TeamOutlined style={{ color: "var(--text-3)" }} />}
              value={draft.sources.vkUrl}
              onChange={(e) => set({ vkUrl: e.target.value.trim() })}
              placeholder="https://vk.com/…"
              aria-label="Сообщество ВКонтакте"
              inputMode="url"
            />
          </Field>
        </div>
      </div>
      <Field label="Пара слов о вас" help="Необязательно. Пригодится, если на сайте мало текста.">
        <Input.TextArea
          value={draft.sources.about}
          onChange={(e) => set({ about: e.target.value })}
          maxLength={ABOUT_MAX_LENGTH}
          showCount
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder="Чем занимаетесь, какие услуги и цены, где находитесь, чем вы лучше других"
          aria-label="Расскажите своими словами"
        />
      </Field>
    </div>
  );
}
