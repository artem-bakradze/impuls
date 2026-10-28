"use client";

import { Button, Flex, Input, Typography } from "antd";
import { AD_TEXT_MAX, AD_TITLE_MAX } from "@/lib/onboarding";
import type { AdDraft } from "@/lib/onboarding";

interface Props {
  ad: AdDraft;
  channel: "search" | "network";
  domain: string;
  label: string;
  onChange: (ad: AdDraft) => void;
  onRemove: (() => void) | null;
}

/** How the ad will look in Yandex search or on partner sites, with the text editable in place. */
export function AdPreview({ ad, channel, domain, label, onChange, onRemove }: Props) {
  const preview =
    channel === "search" ? (
      <div className="ad-preview-search">
        <div className="ad-title">{ad.title || "Заголовок"}</div>
        <div className="ad-domain">{domain} · Реклама</div>
        <div>{ad.text || "Текст объявления"}</div>
      </div>
    ) : (
      <div className="ad-preview-network">
        <div className="ad-image">Здесь будет фото</div>
        <div className="ad-body">
          <Typography.Text strong>{ad.title || "Заголовок"}</Typography.Text>
          <div>{ad.text || "Текст объявления"}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {domain} · Реклама
          </Typography.Text>
        </div>
      </div>
    );
  return (
    <Flex vertical gap={8} data-testid={`ad-${channel}`}>
      {preview}
      <Input value={ad.title} maxLength={AD_TITLE_MAX} showCount onChange={(e) => onChange({ ...ad, title: e.target.value })} aria-label={`${label}: заголовок`} />
      <Input.TextArea value={ad.text} maxLength={AD_TEXT_MAX} showCount autoSize onChange={(e) => onChange({ ...ad, text: e.target.value })} aria-label={`${label}: текст`} />
      {onRemove ? (
        <Button danger type="text" onClick={onRemove} style={{ alignSelf: "flex-start" }}>
          Удалить объявление
        </Button>
      ) : null}
    </Flex>
  );
}
