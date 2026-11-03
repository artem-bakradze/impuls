"use client";

import { CloseOutlined, PictureOutlined } from "@ant-design/icons";
import { Alert, Button, Input } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EffectivenessClass } from "@impuls/core";
import { PENDING_TEXT, runWebJobs } from "@/lib/client-api";
import type { CommandResult } from "@/lib/client-api";
import { formatLocalDate, plural, sentence } from "@/lib/format";
import type { HistoryItem } from "@/lib/history-view";
import { AD_TEXT_MAX, AD_TITLE_MAX } from "@/lib/onboarding";
import type { AdsWork } from "@/lib/server/simulation-screen";
import type { ChangeMark, JournalChange, JournalEntry, JournalSection, ShownAd } from "@/lib/service-work";
import { RollbackDialog } from "../history/RollbackDialog";
import { Chip } from "../ui/primitives";
import type { Tone } from "../ui/primitives";

const leadsWord = (n: number): string => plural(n, "обращение", "обращения", "обращений");
const clicksWord = (n: number): string => plural(n, "переход", "перехода", "переходов");
const shortDate = (date: string): string => formatLocalDate(date).replace(/(\S+) (\S{3})\S*/, "$1 $2");

/** Before two weeks the runs differ mostly by random spread: the numbers stay, the verdict waits. */
const EARLY_DAYS = 14;
/** The journal opens on its last weeks; «Раньше» shows the rest (design decision: long journals on Direct). */
const SHOWN_WEEKS = 8;

/** One line under the month's numbers in a simulation (simulation-mode spec «Контрольный прогон»). */
export function ComparisonNote({ sim }: { sim: NonNullable<AdsWork["sim"]> }) {
  const { comparison, result, decisionDays } = sim;
  if (comparison === null) return <p className="t-small" data-testid="sim-comparison">Сравнение с прогоном без изменений появится после первого завершённого дня.</p>;
  const days = result?.days ?? comparison.service.length;
  const service = result?.service.leads ?? comparison.serviceNow.leads;
  const baseline = result?.baseline.leads ?? comparison.baselineNow.leads;
  const diff = service - baseline;
  const early = result === null && (days < EARLY_DAYS || decisionDays.length === 0);
  const verdict = early ? "пока рано сравнивать" : diff === 0 ? "поровну" : diff > 0 ? `на ${diff} больше` : `на ${-diff} меньше`;
  const tone: Tone = early || diff === 0 ? "neutral" : diff > 0 ? "success" : "danger";
  return (
    <div className="brief-compare" data-testid="sim-comparison">
      <span>
        {result ? "Итог" : "За"} {days} {plural(days, "день", "дня", "дней")}: с сервисом <strong>{service} {leadsWord(service)}</strong>, без него было бы {baseline}
      </span>
      <Chip tone={tone}>{verdict}</Chip>
      <span className="t-small">Разница может быть случайной и не обещает такого же в настоящей рекламе.</span>
    </div>
  );
}

const VERDICTS: Record<EffectivenessClass, { group: string; chip: string; tone: Tone }> = {
  effective: { group: "Приводят клиентов", chip: "Приводит клиентов", tone: "success" },
  borderline: { group: "Под наблюдением", chip: "На грани", tone: "warning" },
  learning: { group: "Собирают данные", chip: "Собирает данные", tone: "neutral" },
  ineffective: { group: "Не приводят клиентов", chip: "Не приводит клиентов", tone: "danger" },
};

type Feedback = { id: string; type: "success" | "error" | "info" | "warning"; text: string } | null;

/** The owner's commands from the ad cards (campaign-settings spec): the same commands as before, through the executor. */
const useCommands = () => {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const run = async (id: string, body: unknown, success: string): Promise<boolean> => {
    setBusy(id);
    const outcome = await runWebJobs<CommandResult>("/api/commands", body);
    setBusy(null);
    if (outcome.kind === "pending") {
      setFeedback({ id, type: "info", text: PENDING_TEXT });
      return false;
    }
    if (outcome.kind === "error") {
      setFeedback({ id, type: "error", text: outcome.message });
      return false;
    }
    const failed = outcome.output.find((r) => r.status === "rejected" || r.status === "failed");
    setFeedback(failed ? { id, type: "error", text: `Не получилось: ${failed.message}` } : { id, type: "success", text: success });
    if (!failed) router.refresh();
    return !failed;
  };
  return { busy, feedback, run };
};

function Mark({ mark, onOpen }: { mark: ChangeMark; onOpen: (entryId: string) => void }) {
  const text = <><span aria-hidden="true">↻</span> {mark.text} · {shortDate(mark.date)}</>;
  return mark.entryId ? (
    <button type="button" className="change-mark" onClick={(e) => { e.stopPropagation(); onOpen(mark.entryId ?? ""); }} data-testid="change-mark">{text}</button>
  ) : (
    <span className="change-mark" data-testid="change-mark">{text}</span>
  );
}

function AdView({ ad, site, lit, selected, onSelect, onOpen, commands }: { ad: ShownAd; site: string; lit: boolean; selected: boolean; onSelect: () => void; onOpen: (entryId: string) => void; commands: ReturnType<typeof useCommands> }) {
  const [edit, setEdit] = useState<{ title: string; text: string } | null>(null);
  const changed = edit !== null && (edit.title.trim() !== ad.title || edit.text.trim() !== ad.text);
  const feedback = commands.feedback && commands.feedback.id.endsWith(ad.id) ? commands.feedback : null;
  return (
    <div className={`work-ad work-ad-${ad.channel}`} data-lit={lit || undefined} data-selected={selected || undefined} data-testid="shown-ad">
      {ad.channel === "network" ? <span className="work-ad-image" aria-hidden="true"><PictureOutlined /></span> : null}
      <div className="work-ad-body">
        {edit === null ? <button type="button" className="work-ad-select" aria-pressed={selected} aria-label={`${ad.title}: показать записи журнала об этом объявлении`} onClick={onSelect} /> : null}
        <span className="work-ad-meta"><span className="work-ad-favicon">{site.slice(0, 1).toUpperCase()}</span>{site} · {ad.channel === "search" ? "Поиск Яндекса" : "Сайт-партнёр"}</span>
        {edit === null ? (
          <>
            <span className="work-ad-title">{ad.title}</span>
            <span className="work-ad-text">{ad.text}</span>
          </>
        ) : (
          <div className="ad-edit work-ad-raised">
            <Input value={edit.title} maxLength={AD_TITLE_MAX} showCount onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label={`${ad.title}: заголовок`} autoFocus />
            <Input.TextArea value={edit.text} maxLength={AD_TEXT_MAX} showCount autoSize onChange={(e) => setEdit({ ...edit, text: e.target.value })} aria-label={`${ad.title}: текст`} />
          </div>
        )}
        <div className="work-ad-stats">
          <Chip tone={VERDICTS[ad.verdict].tone}>{VERDICTS[ad.verdict].chip}</Chip>
          <span>{ad.clicks} {clicksWord(ad.clicks)} · <span className={ad.leads > 0 ? "work-ad-leads" : undefined}>{ad.leads} {leadsWord(ad.leads)}</span> за 7 дней</span>
          {ad.checking ? <Chip tone="accent">В проверке</Chip> : null}
          {ad.fresh ? <Chip tone="accent">Новое</Chip> : null}
          {ad.pending ? <Chip tone="warning">Ждёт проверки Яндекса</Chip> : null}
        </div>
        {ad.change ? <Mark mark={ad.change} onOpen={onOpen} /> : null}
        <div className="work-ad-actions">
          {edit === null ? (
            <>
              <Button size="small" type="text" onClick={() => setEdit({ title: ad.title, text: ad.text })} aria-label={`${ad.title}: изменить текст`}>Изменить текст</Button>
              <Button size="small" type="text" loading={commands.busy === `status-${ad.id}`} onClick={() => void commands.run(`status-${ad.id}`, { action: "adStatus", adId: ad.id, active: false }, "Объявление отключено")} aria-label={`${ad.title}: отключить`}>Отключить</Button>
            </>
          ) : (
            <>
              {changed ? <Button size="small" type="primary" loading={commands.busy === `text-${ad.id}`} onClick={() => void commands.run(`text-${ad.id}`, { action: "adText", adId: ad.id, title: edit.title.trim(), text: edit.text.trim() }, "Текст изменён").then((ok) => ok && setEdit(null))}>Сохранить</Button> : null}
              <Button size="small" onClick={() => setEdit(null)}>Отмена</Button>
            </>
          )}
        </div>
        {feedback ? <Alert className="work-ad-raised" type={feedback.type} showIcon title={feedback.text} /> : null}
      </div>
    </div>
  );
}

function AdsColumn({ work, lit, selected, onSelect, onOpen }: { work: AdsWork; lit: Set<string>; selected: string | null; onSelect: (id: string | null) => void; onOpen: (entryId: string) => void }) {
  const commands = useCommands();
  const groups = (["effective", "borderline", "learning", "ineffective"] as const)
    .map((verdict) => ({ verdict, ads: work.shown.filter((a) => a.verdict === verdict) }))
    .filter((g) => g.ads.length > 0);
  const paused = work.hidden.filter((h) => h.paused);
  return (
    <section className="work-ads" aria-label="Объявления, которые показываются" data-testid="shown-ads">
      <h2 className="t-h3">Сейчас показываются</h2>
      {work.directionChanges.length > 0 ? (
        <div className="direction-changes" data-testid="direction-changes">
          {work.directionChanges.map((mark, i) => (
            <div key={i} className="row" style={{ "--gap": "6px" } as React.CSSProperties}>
              <span className="t-small">Вся реклама {mark.channel === "search" ? "в поиске" : "на сайтах-партнёрах"}:</span>
              <Mark mark={mark} onOpen={onOpen} />
            </div>
          ))}
        </div>
      ) : null}
      {groups.length === 0 ? <p className="t-body">Сейчас ни одно объявление не показывается.</p> : null}
      {groups.map((g) => (
        <div key={g.verdict} className="stack" style={{ "--gap": "8px" } as React.CSSProperties} data-testid={`ads-${g.verdict}`}>
          <span className="t-eyebrow">{VERDICTS[g.verdict].group} · {g.ads.length}</span>
          <div className="work-ad-list">
            {g.ads.map((ad) => (
              <AdView key={ad.id} ad={ad} site={work.site} lit={lit.has(ad.id) || lit.has(ad.directionId)} selected={selected === ad.id} onSelect={() => onSelect(selected === ad.id ? null : ad.id)} onOpen={onOpen} commands={commands} />
            ))}
          </div>
        </div>
      ))}
      {paused.length > 0 ? (
        <div className="hidden-ads" data-testid="hidden-ads">
          <span className="t-small">Отключены:</span>
          {paused.map((h) => (
            <span key={h.id} className="hidden-ad">
              «{h.title}»
              <Button size="small" type="link" loading={commands.busy === `status-${h.id}`} onClick={() => void commands.run(`status-${h.id}`, { action: "adStatus", adId: h.id, active: true }, "Объявление включено")} aria-label={`${h.title}: включить`}>Включить</Button>
            </span>
          ))}
          {commands.feedback && paused.some((h) => commands.feedback?.id.endsWith(h.id)) ? <Alert type={commands.feedback.type} showIcon title={sentence(commands.feedback.text)} /> : null}
        </div>
      ) : null}
    </section>
  );
}

const reducedMotion = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const SEEN_KEY = "impuls:journal-seen";
const seenBefore = (id: string): boolean => {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === id;
  } catch {
    return false;
  }
};
const markSeen = (id: string): void => {
  try {
    window.sessionStorage.setItem(SEEN_KEY, id);
  } catch {
    // A convenience only: without storage the newest record types once per visit.
  }
};

/** The newest record types itself out once; less motion, a second visit or a click shows it at once. */
const useTyping = (entry: JournalEntry | null): { shown: number | null; skip: () => void } => {
  const total = entry ? entry.paragraphs.join(" ").length : 0;
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (entry === null || reducedMotion() || seenBefore(entry.id)) return;
    markSeen(entry.id);
    let count = 0;
    setShown(0);
    const timer = window.setInterval(() => {
      count += 3;
      if (count >= total) {
        window.clearInterval(timer);
        setShown(null);
      } else setShown(count);
    }, 16);
    return () => window.clearInterval(timer);
  }, [entry, total]);
  return { shown, skip: () => setShown(null) };
};

/** Money, percents and counts stand out in the agent's text, so the numbers are read first. */
const NUMBER = /([−+-]?\d[\d  ]*(?:[.,]\d+)?\s?(?:₽|%))|(\d+\s(?:обращени[а-яё]*|переход[а-яё]*))/g;
const withNumbers = (text: string): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(NUMBER)) {
    const at = match.index;
    parts.push(text.slice(last, at), <b key={at}>{match[0]}</b>);
    last = at + match[0].length;
  }
  parts.push(text.slice(last));
  return parts;
};

/** A change in one line: its words, «Вернуть как было» and, for a decision, the facts behind one disclosure. */
function ChangeLine({ change, onRollback }: { change: JournalChange; onRollback: (item: HistoryItem) => void }) {
  const item = change.item;
  const canRollBack = item !== null && !change.reverted && item.rollback.kind === "available";
  return (
    <li data-reverted={change.reverted || undefined} data-testid="journal-change">
      <div className="log-change-row">
        <span className="log-mark" aria-hidden="true">→</span>
        <span className="log-change-text">{change.text}{change.reverted ? <span className="log-reverted"> · отменено</span> : null}</span>
        {canRollBack ? <button type="button" className="log-link" onClick={(e) => { e.stopPropagation(); onRollback(item); }}>Вернуть как было</button> : null}
      </div>
      {/* An irreversible change says why it has no button (change-history spec «Необратимое изменение»). */}
      {item !== null && !change.reverted && item.rollback.kind === "unavailable" && item.reasonCode !== "LAUNCH" ? <p className="log-no-rollback">{item.rollback.reason}</p> : null}
      {change.facts.length > 0 || change.turnId ? (
        <details className="log-facts" onClick={(e) => e.stopPropagation()}>
          <summary>Факты</summary>
          {change.facts.length > 0 ? <dl>{change.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl> : null}
          {change.turnId ? <Link href={`/history/turn/${change.turnId}`} className="log-link">Как сервис принял это решение</Link> : null}
        </details>
      ) : null}
    </li>
  );
}

function Entry({ entry, typed, flash, onLight, onRollback }: { entry: JournalEntry; typed: number | null; flash: boolean; onLight: (ids: string[]) => void; onRollback: (item: HistoryItem) => void }) {
  const when = entry.from ? `${formatLocalDate(entry.from)} — ${formatLocalDate(entry.date)}` : `День ${entry.day} · ${formatLocalDate(entry.date)}`;
  let left = typed ?? Number.POSITIVE_INFINITY;
  const paragraphs = entry.paragraphs.map((p) => {
    const part = p.slice(0, Math.max(0, left));
    left -= p.length + 1;
    return part;
  });
  const typing = typed !== null;
  const lastTyped = paragraphs.findLastIndex((x) => x.length > 0);
  const ids = entry.changes.map((c) => c.historyId).filter((id): id is string => id !== null);
  return (
    <article
      id={`log-${entry.id}`}
      className={`log-entry log-${entry.kind}`}
      data-flash={flash || undefined}
      data-history={ids.join(" ") || undefined}
      data-testid="journal-entry"
      tabIndex={entry.objectIds.length > 0 ? 0 : undefined}
      onMouseEnter={() => onLight(entry.objectIds)}
      onMouseLeave={() => onLight([])}
      onFocus={() => onLight(entry.objectIds)}
      onBlur={() => onLight([])}
    >
      <div className="log-when">
        <time dateTime={entry.date}>{when}</time>
        {entry.weekly ? <span className="log-tag">разбор недели</span> : null}
        {entry.kind === "rules" ? <span className="log-tag log-tag-dim">страховочные правила</span> : null}
      </div>
      {entry.changes.length > 0 ? (
        <ul className="log-headline log-changes" data-testid="journal-headline">
          {entry.changes.map((c, i) => <ChangeLine key={c.historyId ?? i} change={c} onRollback={onRollback} />)}
        </ul>
      ) : entry.headline ? (
        <p className="log-headline" data-testid="journal-headline">{withNumbers(entry.headline)}</p>
      ) : null}
      {paragraphs.map((p, i) => (p.length > 0 ? <p key={i} className="log-text">{typing ? p : withNumbers(p)}{typing && i === lastTyped ? <span className="log-caret" aria-hidden="true" /> : null}</p> : null))}
      {typing ? null : (
        <>
          {entry.checking.map((h, i) => (
            <div key={`c${i}`} className="log-line log-hypothesis">
              <span className="log-mark" aria-hidden="true">?</span>
              {/* The agent often starts the statement with the verb itself: no «Проверяю: Проверяю, …». */}
              <span>{/^провер/i.test(h.statement) ? h.statement : `Проверяю: ${h.statement}`} <span className="log-dim">— итог {formatLocalDate(h.checkOn)}</span></span>
            </div>
          ))}
          {entry.found.map((h, i) => (
            <div key={`f${i}`} className="log-line log-found">
              <span className="log-mark" aria-hidden="true">✓</span>
              <span>Выяснил: {h.statement} — {h.outcome}.{h.result ? ` ${h.result}` : ""}</span>
            </div>
          ))}
          {entry.truths.map((t, i) => (
            <div key={`t${i}`} className={`log-line log-truth log-truth-${t.tone}`} data-testid="insight-truth">
              <span className="log-mark" aria-hidden="true">◆</span>
              <span>{t.text}</span>
            </div>
          ))}
        </>
      )}
    </article>
  );
}

function Section({ section, children }: { section: JournalSection; children: React.ReactNode }) {
  const dates = section.from === section.to ? formatLocalDate(section.from) : `${formatLocalDate(section.from)} — ${formatLocalDate(section.to)}`;
  return (
    <section className="log-section" data-week={section.week ?? undefined} aria-label={section.week ? `Неделя ${section.week}` : dates}>
      <div className="log-divider"><span>{section.week ? `Неделя ${section.week} · ` : ""}{dates}</span></div>
      {children}
    </section>
  );
}

type Focus = { kind: "week"; week: number } | { kind: "entry"; id: string; at: number } | null;

function Console({ work, selected, onClear, onLight, focus }: { work: AdsWork; selected: ShownAd | null; onClear: () => void; onLight: (ids: string[]) => void; focus: Focus }) {
  const router = useRouter();
  const body = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [rollback, setRollback] = useState<HistoryItem | null>(null);
  const sections = useMemo(() => {
    const chosen =
      selected === null
        ? work.journal
        : work.journal
            .map((s) => ({ ...s, entries: s.entries.filter((e) => e.objectIds.includes(selected.id) || e.objectIds.includes(selected.directionId)) }))
            .filter((s) => s.entries.length > 0);
    const focusedWeek = focus?.kind === "week" ? chosen.findIndex((s) => s.week === focus.week) : -1;
    return all || (focusedWeek !== -1 && focusedWeek < chosen.length - SHOWN_WEEKS) ? chosen : chosen.slice(-SHOWN_WEEKS);
  }, [work.journal, selected, all, focus]);
  const earlier = !all && selected === null && work.journal.length > sections.length;
  const newest = work.journal.at(-1)?.entries.findLast((e) => e.kind === "agent") ?? null;
  const isNewestLast = newest !== null && work.journal.at(-1)?.entries.at(-1) === newest;
  const typing = useTyping(isNewestLast && selected === null && focus === null ? newest : null);
  const brief = work.brief;

  useEffect(() => {
    const el = body.current;
    if (el === null) return;
    if (focus?.kind === "entry") {
      // Scrolls the journal and, when the record is out of sight (below the ads on a phone), the page too.
      document.getElementById(`log-${focus.id}`)?.scrollIntoView?.({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
      setFlash(focus.id);
      const timer = window.setTimeout(() => setFlash(null), 1600);
      return () => window.clearTimeout(timer);
    }
    const target = focus?.kind === "week" ? el.querySelector<HTMLElement>(`[data-week="${focus.week}"]`) : null;
    el.scrollTop = target ? target.offsetTop - el.offsetTop : el.scrollHeight;
    return undefined;
  }, [focus, selected, typing.shown === null]);

  return (
    <section className="work-console" aria-label="Журнал помощника" data-testid="agent-journal" onClick={typing.skip}>
      <header className="console-head">
        <span className="console-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="console-title">Журнал помощника</span>
        {selected ? (
          <button type="button" className="console-filter" onClick={onClear} data-testid="journal-filter">
            только «{selected.title}» <CloseOutlined aria-label="Показать все записи" />
          </button>
        ) : brief ? (
          <span className="console-live" data-testid="journal-week-line">
            За неделю: {brief.changes.length} {plural(brief.changes.length, "изменение", "изменения", "изменений")} · проверяю {brief.checks.count} {plural(brief.checks.count, "гипотезу", "гипотезы", "гипотез")}
          </span>
        ) : null}
      </header>
      <div className="console-body" ref={body} aria-live="polite">
        {earlier ? <button type="button" className="log-earlier" onClick={(e) => { e.stopPropagation(); setAll(true); }}>Раньше</button> : null}
        {sections.length === 0 ? (
          <p className="log-empty">{selected ? "Об этом объявлении записей пока нет." : "Записей пока нет. Каждое утро помощник разбирает рекламу и пишет сюда, что заметил и что поменял."}</p>
        ) : (
          sections.map((s) => (
            <Section key={`${s.week ?? "d"}:${s.from}`} section={s}>
              {s.entries.map((e) => <Entry key={e.id} entry={e} typed={e === newest ? typing.shown : null} flash={flash === e.id} onLight={onLight} onRollback={setRollback} />)}
            </Section>
          ))
        )}
        <p className="log-prompt" aria-hidden="true">
          <span className="log-dim">{work.sim?.ended ? "Сценарий закончился" : work.sim ? "Жду следующего шага" : "Следующий разбор — завтра утром"}</span>
          <span className="log-caret" />
        </p>
      </div>
      {rollback ? <RollbackDialog item={rollback} items={work.history} names={work.names} onClose={(changed) => { setRollback(null); if (changed) router.refresh(); }} /> : null}
    </section>
  );
}

/** The ads people see now and the agent's journal, side by side (analytics spec «Объявления на экране «Реклама»»). */
export function WorkArea({ work, focusWeek = null }: { work: AdsWork; focusWeek?: number | null }) {
  const [lit, setLit] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(() => {
    if (focusWeek !== null) return { kind: "week", week: focusWeek };
    // An old link to a history record (`/history#<id>`) lands here with the hash of that record.
    const hash = typeof window === "undefined" ? "" : window.location.hash.slice(1);
    const entry = hash ? work.journal.flatMap((s) => s.entries).find((e) => e.changes.some((c) => c.historyId === hash) || e.id === hash.replace(/^log-/, "")) : undefined;
    return entry ? { kind: "entry", id: entry.id, at: 0 } : null;
  });
  const selectedAd = work.shown.find((a) => a.id === selected) ?? null;
  const open = (id: string) => {
    setSelected(null);
    setFocus({ kind: "entry", id, at: Date.now() });
  };
  return (
    <div className="work-grid">
      <AdsColumn work={work} lit={lit} selected={selected} onSelect={setSelected} onOpen={open} />
      <Console work={work} selected={selectedAd} onClear={() => setSelected(null)} onLight={(ids) => setLit(new Set(ids))} focus={focus} />
    </div>
  );
}
