"use client";

import { Alert, Flex, Input, Typography } from "antd";
import { ABOUT_MAX_LENGTH } from "@/lib/onboarding";
import type { StepProps } from "./Wizard";

export function SourcesStep({ draft, onChange }: StepProps) {
  const set = (patch: Partial<StepProps["draft"]["sources"]>) => onChange({ ...draft, sources: { ...draft.sources, ...patch } });
  return (
    <Flex vertical gap={16}>
      <Typography.Paragraph style={{ margin: 0 }}>
        Укажите адрес вашего сайта — на него будет вести реклама. Ссылки на Яндекс Карты и ВКонтакте и рассказ своими словами помогут нам лучше понять бизнес.
      </Typography.Paragraph>
      <label>
        <Typography.Text strong>Ваш сайт</Typography.Text>
        <Input value={draft.sources.siteUrl} onChange={(e) => set({ siteUrl: e.target.value.trim() })} placeholder="https://..." aria-label="Ваш сайт" inputMode="url" />
      </label>
      <label>
        <Typography.Text strong>Организация в Яндекс Картах</Typography.Text>
        <Input value={draft.sources.mapsUrl} onChange={(e) => set({ mapsUrl: e.target.value.trim() })} placeholder="https://yandex.ru/maps/org/..." aria-label="Организация в Яндекс Картах" inputMode="url" />
      </label>
      <label>
        <Typography.Text strong>Сообщество ВКонтакте</Typography.Text>
        <Input value={draft.sources.vkUrl} onChange={(e) => set({ vkUrl: e.target.value.trim() })} placeholder="https://vk.com/..." aria-label="Сообщество ВКонтакте" inputMode="url" />
      </label>
      <label>
        <Typography.Text strong>Расскажите своими словами</Typography.Text>
        <Input.TextArea
          value={draft.sources.about}
          onChange={(e) => set({ about: e.target.value })}
          maxLength={ABOUT_MAX_LENGTH}
          showCount
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder="Чем занимаетесь, какие услуги и цены, где находитесь, чем вы лучше других"
          aria-label="Расскажите своими словами"
        />
      </label>
      <Alert
        type="info"
        showIcon
        title="Пока сервис не умеет сам читать страницы по ссылкам"
        description="Ссылки мы сохраним. На следующем шаге заполните карточку бизнеса сами — это займёт пару минут."
      />
    </Flex>
  );
}
