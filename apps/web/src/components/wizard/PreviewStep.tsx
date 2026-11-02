"use client";

import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Segmented } from "antd";
import { useState } from "react";
import { hasOwnSite } from "@/lib/onboarding";
import type { AdDraft } from "@/lib/onboarding";
import { AdPreview } from "./AdPreview";
import type { StepProps } from "./Wizard";

const hostOf = (url: string): string => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function PreviewStep({ draft, onChange, onRegenerate, busy, errors = {} }: StepProps & { onRegenerate: () => void; busy: boolean }) {
  const ads = draft.ads ?? { search: [], network: [] };
  const [channel, setChannel] = useState<"search" | "network">("search");
  const domain = hasOwnSite(draft) ? hostOf(draft.sources.siteUrl) : "ваш сайт";
  const total = ads.search.length + ads.network.length;
  const update = (which: "search" | "network", list: AdDraft[]) => onChange({ ...draft, ads: { ...ads, [which]: list } });
  const query = [draft.card.services.find((s) => s.name.trim() !== "")?.name ?? draft.card.category, draft.card.city].filter(Boolean).join(" ").toLowerCase();
  const list = ads[channel];

  return (
    <div id="field-ads" className={errors.ads ? "stack field-invalid" : "stack"} style={{ "--gap": "18px" } as React.CSSProperties}>
      {errors.ads ? (
        <div className="field-error" role="alert">
          {errors.ads}
        </div>
      ) : null}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Segmented
          style={{ maxWidth: "100%", overflowX: "auto" }}
          value={channel}
          onChange={(value) => setChannel(value as "search" | "network")}
          options={[
            { value: "search", label: `Поиск Яндекса · ${ads.search.length}` },
            { value: "network", label: `Сайты-партнёры · ${ads.network.length}` },
          ]}
        />
        <Button type="text" icon={<ReloadOutlined aria-hidden="true" />} onClick={onRegenerate} loading={busy}>
          Написать заново
        </Button>
      </div>

      {channel === "search" ? (
        <div className="serp">
          <div className="serp-bar">
            <SearchOutlined style={{ color: "var(--text-3)" }} />
            <div className="serp-query" aria-label="Пример запроса">
              {query || "ваша услуга"}
            </div>
          </div>
          {list.length === 0 ? <div className="empty t-small">Здесь объявлений не будет.</div> : null}
          {list.map((ad, index) => (
            <AdPreview
              key={index}
              ad={ad}
              channel="search"
              domain={domain}
              label={`В поиске Яндекса, объявление ${index + 1}`}
              onChange={(next) => update("search", list.map((a, i) => (i === index ? next : a)))}
              onRemove={total > 1 ? () => update("search", list.filter((_, i) => i !== index)) : null}
            />
          ))}
        </div>
      ) : (
        <>
          <span className="t-small">Так объявления выглядят на сайтах и в приложениях, которые показывают рекламу Яндекса.</span>
          {list.length === 0 ? <div className="empty t-small">Здесь объявлений не будет.</div> : null}
          <div className="net-grid">
            {list.map((ad, index) => (
              <AdPreview
                key={index}
                ad={ad}
                channel="network"
                domain={domain}
                label={`На сайтах-партнёрах Яндекса, объявление ${index + 1}`}
                onChange={(next) => update("network", list.map((a, i) => (i === index ? next : a)))}
                onRemove={total > 1 ? () => update("network", list.filter((_, i) => i !== index)) : null}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
