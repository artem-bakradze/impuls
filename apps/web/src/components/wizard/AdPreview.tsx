"use client";

import { CheckOutlined, DeleteOutlined, EditOutlined, PictureOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Input, Tooltip } from "antd";
import { useState } from "react";
import { AD_TEXT_MAX, AD_TITLE_MAX, adImageUrl, IMAGE_NOTES } from "@/lib/onboarding";
import type { AdDraft, NetworkAdDraft } from "@/lib/onboarding";

interface Props<A extends AdDraft> {
  ad: A;
  channel: "search" | "network";
  domain: string;
  label: string;
  onChange: (ad: A) => void;
  onRemove: (() => void) | null;
  /** A partner-site ad's picture: being drawn now, and «Другая картинка» (network-ad-images). */
  picture?: { drawing: boolean; onRedraw?: () => void };
}

/** The picture of a partner-site ad, «Рисуем картинку…» while it is drawn, or a plain mark while it has none. */
function AdImage({ ad, drawing }: { ad: Partial<NetworkAdDraft>; drawing: boolean }) {
  if (drawing) {
    return (
      <div className="ad-image ad-image-drawing" role="status" data-testid="ad-image-drawing">
        <PictureOutlined aria-hidden="true" />
        <span>Рисуем картинку…</span>
      </div>
    );
  }
  if (ad.imageId !== undefined) {
    return <img className="ad-image" src={adImageUrl(ad.imageId)} alt="Картинка объявления" width={1024} height={1024} data-testid="ad-image" />;
  }
  return (
    <div className="ad-image" aria-hidden="true">
      <PictureOutlined />
    </div>
  );
}

/** One ad as it will look in Yandex search or on partner sites; «Изменить» edits it in place. */
export function AdPreview<A extends AdDraft & Partial<NetworkAdDraft>>({ ad, channel, domain, label, onChange, onRemove, picture }: Props<A>) {
  const [editing, setEditing] = useState(false);
  const redraw = picture?.onRedraw;
  const actions = (
    <div className="ad-actions">
      <Tooltip title={editing ? "Готово" : "Изменить текст"}>
        <Button size="small" type={editing ? "primary" : "default"} icon={editing ? <CheckOutlined /> : <EditOutlined />} onClick={() => setEditing(!editing)} aria-label={editing ? `${label}: готово` : `${label}: изменить`}>{editing ? "Готово" : "Изменить"}</Button>
      </Tooltip>
      {channel === "network" && redraw !== undefined ? (
        <Tooltip title="Нарисовать другую картинку, текст останется">
          <Button size="small" icon={<ReloadOutlined aria-hidden="true" />} onClick={redraw} disabled={picture?.drawing === true} aria-label={`${label}: другая картинка`}>Другая картинка</Button>
        </Tooltip>
      ) : null}
      {onRemove ? (
        <Tooltip title="Убрать объявление">
          <Button size="small" icon={<DeleteOutlined aria-hidden="true" />} onClick={onRemove} aria-label={`${label}: убрать`}>Убрать</Button>
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
  const note = picture?.drawing === true || ad.imageNote === undefined || ad.imageNote === null ? null : ad.imageNote;
  return (
    <div className="ad-net" data-testid="ad-network">
      {actions}
      <AdImage ad={ad} drawing={picture?.drawing === true} />
      {note !== null ? (
        <div className="ad-image-note t-small" role="note" data-testid="ad-image-note">
          {IMAGE_NOTES[note]}
          {note === "failed" && redraw !== undefined ? (
            <button type="button" className="link-button" onClick={redraw}>
              Попробовать ещё раз
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="ad-body">
        <div className="ad-title">{ad.title || "Заголовок"}</div>
        <div className="ad-text">{ad.text || "Текст объявления"}</div>
        <div className="t-small">{domain} · Реклама</div>
        {editor}
      </div>
    </div>
  );
}
