"use client";

import { MoreOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Dropdown, Input } from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";
import type { EffectivenessClass } from "@impuls/core";
import { formatRub, plural } from "@/lib/format";
import { AD_TEXT_MAX, AD_TITLE_MAX } from "@/lib/onboarding";
import type { AdsWork } from "@/lib/server/simulation-screen";
import { VERDICT_GROUPS, verdictRule } from "@/lib/service-work";
import type { ShownAd } from "@/lib/service-work";
import { useDayWords } from "../ui/DayWordsContext";
import { useCommands } from "./useCommands";

const leadsWord = (n: number): string => plural(n, "обращение", "обращения", "обращений");

/** «потрачено 693 ₽ · 5 обращений по 138 ₽»: every number of the 7 days says what it is. */
export const adStatsText = (ad: Pick<ShownAd, "spend" | "leads" | "costPerLead">): string =>
  `потрачено ${formatRub(ad.spend)} · ${ad.leads === 0 ? "обращений нет" : `${ad.leads} ${leadsWord(ad.leads)}${ad.costPerLead === null ? "" : ` по ${formatRub(ad.costPerLead)}`}`}`;

const ORDER: EffectivenessClass[] = ["effective", "borderline", "learning", "ineffective"];

function AdRow({ ad, site, commands }: { ad: ShownAd; site: string; commands: ReturnType<typeof useCommands> }) {
  const words = useDayWords();
  const [edit, setEdit] = useState<{ title: string; text: string } | null>(null);
  const changed = edit !== null && (edit.title.trim() !== ad.title || edit.text.trim() !== ad.text);
  const feedback = commands.feedback && (commands.feedback.id === `text-${ad.id}` || commands.feedback.id === `status-${ad.id}`) ? commands.feedback : null;
  const labels = [ad.checking ? "В проверке" : null, ad.fresh ? "Новое" : null, ad.pending ? "На проверке" : null].filter((x): x is string => x !== null);
  const startEdit = () => setEdit({ title: ad.title, text: ad.text });
  const switchOff = () => void commands.run(`status-${ad.id}`, { action: "adStatus", adId: ad.id, active: false }, "Объявление отключено");
  const menu: MenuProps = {
    items: [
      { key: "edit", label: "Изменить текст" },
      { key: "off", label: "Отключить" },
    ],
    onClick: ({ key }) => (key === "edit" ? startEdit() : switchOff()),
  };
  return (
    <article className="ad-row" data-testid="shown-ad">
      <div className="ad-row-head">
        <div className="ad-row-main">
          <div className="ad-row-meta">
            <span className="ad-row-favicon" aria-hidden="true">
              {site.slice(0, 1).toUpperCase()}
            </span>
            {site} · {ad.channel === "search" ? "поиск" : "сайты-партнёры"}
          </div>
          <h3 className="ad-row-title">{ad.title}</h3>
          <p className="ad-row-text">{ad.text}</p>
          <p className="ad-row-stats" data-testid="ad-stats">
            {adStatsText(ad)}
          </p>
          {labels.length > 0 ? <p className="ad-row-labels">{labels.join(" · ")}</p> : null}
          {ad.change ? (
            <span className="ad-mark" data-testid="change-mark">
              ↻ {ad.change.text} · {words.date(ad.change.date)}
            </span>
          ) : null}
        </div>
        {edit === null ? (
          <>
            {/* A mouse sees both actions on hover or focus; a touch screen opens them from one button (analytics spec «Сводка»). */}
            <div className="ad-row-hover">
              <button type="button" className="ad-row-action" onClick={startEdit} aria-label={`${ad.title}: изменить текст`}>
                Изменить текст
              </button>
              <button type="button" className="ad-row-action" onClick={switchOff} disabled={commands.busy === `status-${ad.id}`} aria-label={`${ad.title}: отключить`}>
                Отключить
              </button>
            </div>
            <div className="ad-row-touch">
              <Dropdown menu={menu} trigger={["click"]} placement="bottomRight">
                <Button type="text" size="small" icon={<MoreOutlined aria-hidden="true" />} aria-label={`${ad.title}: действия`} />
              </Dropdown>
            </div>
          </>
        ) : null}
      </div>
      {edit !== null ? (
        <div className="ad-edit">
          <Input value={edit.title} maxLength={AD_TITLE_MAX} showCount onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label={`${ad.title}: заголовок`} autoFocus />
          <Input.TextArea value={edit.text} maxLength={AD_TEXT_MAX} showCount autoSize onChange={(e) => setEdit({ ...edit, text: e.target.value })} aria-label={`${ad.title}: текст`} />
          <div className="ad-edit-actions">
            {changed ? (
              <Button size="small" type="primary" loading={commands.busy === `text-${ad.id}`} onClick={() => void commands.run(`text-${ad.id}`, { action: "adText", adId: ad.id, title: edit.title.trim(), text: edit.text.trim() }, "Текст изменён").then((ok) => ok && setEdit(null))}>
                Сохранить
              </Button>
            ) : null}
            <Button size="small" onClick={() => setEdit(null)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
      {feedback ? <Alert type={feedback.type} showIcon title={feedback.text} className="ad-feedback" /> : null}
    </article>
  );
}

/** The ads sheet: money first, one group per estimate, actions behind one menu instead of two buttons per ad. */
export function AdsSheet({ work, onClose }: { work: AdsWork; onClose: () => void }) {
  const words = useDayWords();
  const commands = useCommands();
  const groups = ORDER.map((verdict) => ({ verdict, ads: work.shown.filter((a) => a.verdict === verdict) })).filter((g) => g.ads.length > 0);
  const paused = work.hidden.filter((h) => h.paused);
  return (
    <Drawer open onClose={onClose} closable={{ "aria-label": "Закрыть" }} placement="right" width="min(560px, 100vw)" title="Объявления" className="sheet" styles={{ body: { padding: 0 } }}>
      <div className="sheet-body" data-testid="shown-ads">
        <p className="sheet-note">за 7 дней</p>
        {work.directionChanges.length > 0 ? (
          <div className="ad-direction-changes" data-testid="direction-changes">
            {work.directionChanges.map((mark, i) => (
              <span key={i} className="ad-mark" data-testid="change-mark">
                ↻ {mark.text} · {words.date(mark.date)}
              </span>
            ))}
          </div>
        ) : null}
        {groups.length === 0 ? <p className="sheet-empty">Сейчас ни одно объявление не показывается.</p> : null}
        {groups.map((g) => (
          <section key={g.verdict} data-testid={`ads-${g.verdict}`}>
            <h3 className="sheet-group" data-verdict={g.verdict}>
              {VERDICT_GROUPS[g.verdict]} · {g.ads.length}
            </h3>
            <p className="sheet-group-rule">{verdictRule(g.verdict, work.cso)}</p>
            {g.ads.map((ad) => (
              <AdRow key={ad.id} ad={ad} site={work.site} commands={commands} />
            ))}
          </section>
        ))}
        {paused.length > 0 ? (
          <section className="ad-hidden" data-testid="hidden-ads">
            <h3 className="sheet-group">Отключены</h3>
            {paused.map((h) => (
              <div key={h.id} className="ad-hidden-row">
                <span>{h.title}</span>
                <Button size="small" type="link" loading={commands.busy === `status-${h.id}`} onClick={() => void commands.run(`status-${h.id}`, { action: "adStatus", adId: h.id, active: true }, "Объявление включено")} aria-label={`${h.title}: включить`}>
                  Включить
                </Button>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
