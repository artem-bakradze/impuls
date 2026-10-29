"use client";

import { CheckOutlined, DeleteOutlined, EditOutlined, PictureOutlined } from "@ant-design/icons";
import { Button, Input, Tooltip } from "antd";
import { useState } from "react";
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

/** One ad as it will look in Yandex search or on partner sites; «Изменить» edits it in place. */
export function AdPreview({ ad, channel, domain, label, onChange, onRemove }: Props) {
  const [editing, setEditing] = useState(false);
  const actions = (
    <div className="ad-actions">
      <Tooltip title={editing ? "Готово" : "Изменить текст"}>
        <Button size="small" type={editing ? "primary" : "default"} icon={editing ? <CheckOutlined /> : <EditOutlined />} onClick={() => setEditing(!editing)} aria-label={editing ? `${label}: готово` : `${label}: изменить`} />
      </Tooltip>
      {onRemove ? (
        <Tooltip title="Убрать объявление">
          <Button size="small" icon={<DeleteOutlined aria-hidden="true" />} onClick={onRemove} aria-label={`${label}: убрать`} />
        </Tooltip>
      ) : null}
    </div>
  );
  const editor = editing ? (
    <div className="ad-edit fade-in">
      <Input value={ad.title} maxLength={AD_TITLE_MAX} showCount onChange={(e) => onChange({ ...ad, title: e.target.value })} aria-label={`${label}: заголовок`} autoFocus />
      <Input.TextArea value={ad.text} maxLength={AD_TEXT_MAX} showCount autoSize onChange={(e) => onChange({ ...ad, text: e.target.value })} aria-label={`${label}: текст`} />
    </div>
  ) : null;

  if (channel === "search") {
    return (
      <div className="ad-card" data-testid="ad-search">
        {actions}
        <div className="ad-meta">
          <span className="ad-favicon">{domain.slice(0, 1).toUpperCase()}</span>
          {domain}
          <span>·</span>
          <span>Реклама</span>
        </div>
        <div className="ad-title">{ad.title || "Заголовок"}</div>
        <div className="ad-text">{ad.text || "Текст объявления"}</div>
        {editor}
      </div>
    );
  }
  return (
    <div className="ad-net" data-testid="ad-network">
      {actions}
      <div className="ad-image" aria-hidden="true">
        <PictureOutlined />
      </div>
      <div className="ad-body">
        <div className="ad-title">{ad.title || "Заголовок"}</div>
        <div className="ad-text">{ad.text || "Текст объявления"}</div>
        <div className="t-small">{domain} · Реклама</div>
        {editor}
      </div>
    </div>
  );
}
