"use client";

import { EnvironmentOutlined, GlobalOutlined, TeamOutlined } from "@ant-design/icons";
import { Input } from "antd";
import { ABOUT_MAX_LENGTH, normalizeLink } from "@/lib/onboarding";
import type { LinkKind } from "@/lib/onboarding";
import { Field } from "./Field";
import type { StepProps } from "./Wizard";

type SourceField = "siteUrl" | "mapsUrl" | "vkUrl";

export function SourcesStep({ draft, onChange, errors = {} }: StepProps) {
  const set = (patch: Partial<StepProps["draft"]["sources"]>) => onChange({ ...draft, sources: { ...draft.sources, ...patch } });
  /** «nogotok.ru» becomes «https://nogotok.ru» when the owner leaves the field; text that is not a link stays as typed. */
  const tidy = (field: SourceField, kind: LinkKind) => {
    const link = normalizeLink(kind, draft.sources[field]);
    if (link !== null && link !== draft.sources[field]) set({ [field]: link });
  };
  // The extra sources are folded until needed; what was typed or an error keeps them open (business-onboarding «Шаги мастера»).
  const extras = draft.sources.mapsUrl !== "" || draft.sources.vkUrl !== "" || draft.sources.about !== "" || errors.mapsUrl !== undefined || errors.vkUrl !== undefined;
  return (
    <div className="form-section">
      <Field id="siteUrl" label="Ваш сайт" error={errors.siteUrl} help="Можно без https:// — например, nogotok.ru. На эту страницу будут вести объявления, а карточку бизнеса мы заполним по ней сами.">
        <Input
          size="large"
          prefix={<GlobalOutlined style={{ color: "var(--text-3)" }} />}
          value={draft.sources.siteUrl}
          onChange={(e) => set({ siteUrl: e.target.value })}
          onBlur={() => tidy("siteUrl", "site")}
          placeholder="nogotok.ru"
          aria-label="Ваш сайт"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
        />
      </Field>
      <details className="context-details" open={extras} data-testid="more-sources">
      <summary>Ещё источники — необязательно</summary>
      <div className="row" style={{ "--gap": "16px", alignItems: "flex-start", marginTop: 12 } as React.CSSProperties}>
        <div style={{ flex: "1 1 240px" }}>
          <Field id="mapsUrl" label="Яндекс Карты" error={errors.mapsUrl} help="Необязательно">
            <Input
              prefix={<EnvironmentOutlined style={{ color: "var(--text-3)" }} />}
              value={draft.sources.mapsUrl}
              onChange={(e) => set({ mapsUrl: e.target.value })}
              onBlur={() => tidy("mapsUrl", "maps")}
              placeholder="yandex.ru/maps/org/…"
              aria-label="Организация в Яндекс Картах"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>
        </div>
        <div style={{ flex: "1 1 240px" }}>
          <Field id="vkUrl" label="ВКонтакте" error={errors.vkUrl} help="Необязательно. Подойдёт и просто @название">
            <Input
              prefix={<TeamOutlined style={{ color: "var(--text-3)" }} />}
              value={draft.sources.vkUrl}
              onChange={(e) => set({ vkUrl: e.target.value })}
              onBlur={() => tidy("vkUrl", "vk")}
              placeholder="vk.com/nogotok"
              aria-label="Сообщество ВКонтакте"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
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
      </details>
    </div>
  );
}
