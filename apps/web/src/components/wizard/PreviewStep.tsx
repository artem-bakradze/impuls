"use client";

import { Button, Divider, Flex, Typography } from "antd";
import { hasOwnSite } from "@/lib/onboarding";
import type { AdDraft } from "@/lib/onboarding";
import { formatRub } from "@/lib/format";
import { AdPreview } from "./AdPreview";
import type { StepProps } from "./Wizard";

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function PreviewStep({ draft, onChange, onRegenerate, busy }: StepProps & { onRegenerate: () => void; busy: boolean }) {
  const ads = draft.ads ?? { search: [], network: [] };
  const domain = hasOwnSite(draft) ? hostOf(draft.sources.siteUrl) : "ваш сайт";
  const total = ads.search.length + ads.network.length;
  const update = (channel: "search" | "network", list: AdDraft[]) => onChange({ ...draft, ads: { ...ads, [channel]: list } });
  const section = (channel: "search" | "network", title: string, hint: string) => (
    <Flex vertical gap={16}>
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        <Typography.Text type="secondary">{hint}</Typography.Text>
      </div>
      {ads[channel].length === 0 ? <Typography.Text type="secondary">Здесь объявлений не будет.</Typography.Text> : null}
      {ads[channel].map((ad, index) => (
        <AdPreview
          key={index}
          ad={ad}
          channel={channel}
          domain={domain}
          label={`${title}, объявление ${index + 1}`}
          onChange={(next) => update(channel, ads[channel].map((a, i) => (i === index ? next : a)))}
          onRemove={total > 1 ? () => update(channel, ads[channel].filter((_, i) => i !== index)) : null}
        />
      ))}
    </Flex>
  );
  return (
    <Flex vertical gap={16}>
      <Typography.Paragraph style={{ margin: 0 }}>
        Мы написали объявления по вашей карточке. Поправьте текст или удалите лишнее — до запуска их никто не увидит.
      </Typography.Paragraph>
      {section("search", "В поиске Яндекса", "Когда человек ищет вашу услугу в Яндексе")}
      <Divider style={{ margin: 0 }} />
      {section("network", "На сайтах-партнёрах Яндекса", "На сайтах и в приложениях, которые показывают рекламу Яндекса")}
      <Divider style={{ margin: 0 }} />
      <Typography.Text>
        Зона показа: до {draft.card.radiusKm} км от адреса «{draft.card.address}». Бюджет: {formatRub((draft.budget.monthlyBudgetRub ?? 0) * 100)} в месяц.
      </Typography.Text>
      <Button onClick={onRegenerate} loading={busy} style={{ alignSelf: "flex-start" }}>
        Написать объявления заново
      </Button>
    </Flex>
  );
}
