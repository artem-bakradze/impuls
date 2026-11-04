"use client";

import { CheckCircleFilled } from "@ant-design/icons";
import { Drawer } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatLocalDate, formatRub, plural } from "@/lib/format";
import type { HistoryItem } from "@/lib/history-view";
import { capitalize } from "@/lib/day-words";
import { noteExpect, noteSeen } from "@/lib/review-note";
import type { AdsWork } from "@/lib/server/simulation-screen";
import type { SummaryModel } from "@/lib/summary-model";
import type { JournalChange, JournalEntry, JournalSection } from "@/lib/service-work";
import { AgentAvatar } from "../ui/AgentAvatar";
import { useDayWords } from "../ui/DayWordsContext";
import type { Tone } from "../ui/primitives";

const SHOWN_WEEKS = 8;
const leadsWord = (n: number): string => plural(n, "обращение", "обращения", "обращений");

/** One line under the month's numbers in a simulation: the same words as before, now inside the history sheet. */
export function ComparisonNote({ sim }: { sim: NonNullable<AdsWork["sim"]> }) {
  const { comparison, result, decisionDays } = sim;
  if (comparison === null) return <p className="j-compare" data-testid="sim-comparison">Сравнение с прогоном без изменений появится после первого завершённого дня.</p>;
  const days = result?.days ?? comparison.service.length;
  const service = result?.service.leads ?? comparison.serviceNow.leads;
  const baseline = result?.baseline.leads ?? comparison.baselineNow.leads;
  const diff = service - baseline;
  const early = result === null && (days < 14 || decisionDays.length === 0);
  const verdict = early ? "пока рано сравнивать" : diff === 0 ? "поровну" : diff > 0 ? `на ${diff} больше` : `на ${-diff} меньше`;
  const tone: Tone = early || diff === 0 ? "neutral" : diff > 0 ? "success" : "danger";
  return (
    <div className="j-compare" data-testid="sim-comparison">
      <span>
        {result ? "Итог" : "За"} {days} {plural(days, "день", "дня", "дней")}: с сервисом <strong>{service} {leadsWord(service)}</strong>, без него было бы {baseline}
      </span>
      <span className="j-verdict" data-tone={tone === "neutral" ? undefined : tone}>
        {verdict}
      </span>
      <span className="t-small">Разница может быть случайной и не обещает такого же в настоящей рекламе.</span>
    </div>
  );
}

/**
 * One change as a done action, the same as in the review on «Реклама»: a check, the change in words and «Вернуть как
 * было» when it can go back (insights spec «Лента инсайтов и связь с историей»). The owner's and the cabinet's changes go
 * without the check, in the owner's bubble.
 */
function ChangeLine({ change, owner, onRollback }: { change: JournalChange; owner: boolean; onRollback: (item: HistoryItem) => void }) {
  const words = useDayWords();
  const item = change.item;
  const canRollBack = item !== null && !change.reverted && item.rollback.kind === "available";
  return (
    <li className={owner ? "j-owner-line" : "studio-msg-action j-action"} data-reverted={change.reverted || undefined} data-testid="journal-change">
      {owner ? null : <CheckCircleFilled className="studio-msg-done" aria-label={change.reverted ? "отменено" : "сделано"} />}
      <div className="j-action-main">
        <span className={owner ? "log-change-text" : "studio-msg-action-text log-change-text"}>
          {words.text(change.text)}
          {change.reverted ? <span className="studio-msg-dim"> — отменено</span> : null}
        </span>
        {item !== null && !change.reverted && item.rollback.kind === "unavailable" && item.reasonCode !== "LAUNCH" ? <p className="j-no-rollback">{item.rollback.reason}</p> : null}
      </div>
      {canRollBack ? (
        <button type="button" className="studio-msg-undo" onClick={() => onRollback(item)}>
          Вернуть как было
        </button>
      ) : null}
    </li>
  );
}

/**
 * A record as a message (analytics spec «Сводка»): the service's in its bubble by its mark, with what it did first, then
 * its reasoning, what it found out, what it expects and, in a simulation, the truth; the owner's on the other side. A
 * day's records stand under one date, which the next record of the same day does not repeat.
 */
function Entry({ entry, sameDay, onRollback }: { entry: JournalEntry; sameDay: boolean; onRollback: (item: HistoryItem) => void }) {
  const words = useDayWords();
  const when = words.simulation
    ? entry.from
      ? capitalize(words.range(entry.from, entry.date))
      : `День ${entry.day}`
    : entry.from
      ? `${formatLocalDate(entry.from)} — ${formatLocalDate(entry.date)}`
      : `День ${entry.day} · ${formatLocalDate(entry.date)}`;
  const date = sameDay ? null : (
    <p className="j-day">
      <time dateTime={entry.date}>{when}</time>
    </p>
  );
  const changes =
    entry.changes.length > 0 ? (
      <ul className="j-changes" data-testid="journal-headline">
        {entry.changes.map((c, i) => (
          <ChangeLine key={c.historyId ?? i} change={c} owner={entry.kind === "owner"} onRollback={onRollback} />
        ))}
      </ul>
    ) : null;

  if (entry.kind === "owner") {
    return (
      <article id={`log-${entry.id}`} className="j-entry j-owner" data-testid="journal-entry" data-same-day={sameDay || undefined}>
        {date}
        <div className="j-owner-bubble">
          {changes}
          {entry.paragraphs.map((p, i) => (
            <p key={i} className="studio-msg-text">
              {words.text(p)}
            </p>
          ))}
        </div>
      </article>
    );
  }

  const [first, ...rest] = noteSeen({ headline: entry.headline, paragraphs: entry.paragraphs, found: [] }, words);
  const found = noteSeen({ headline: null, paragraphs: [], found: entry.found }, words);
  const expected = noteExpect(entry, words);
  const tag = entry.weekly ? "разбор недели" : entry.kind === "rules" ? "страховочные правила" : null;
  return (
    <article id={`log-${entry.id}`} className="j-entry" data-testid="journal-entry" data-same-day={sameDay || undefined}>
      {date}
      <div className="j-msg">
        <span className="j-avatar">
          <AgentAvatar size={28} />
        </span>
        <div className="j-msg-main">
          <p className="j-msg-who">
            Импульс{tag ? <span className="j-tag"> · {tag}</span> : null}
          </p>
          <div className="studio-bubble j-bubble">
            {changes}
            {first ? <p className="studio-msg-text">{first}</p> : null}
            {rest.length > 0 ? (
              <details className="j-more">
                <summary>Читать дальше</summary>
                {rest.map((p, i) => (
                  <p key={i} className="studio-msg-text">
                    {p}
                  </p>
                ))}
              </details>
            ) : null}
            {found.map((p, i) => (
              <p key={`f${i}`} className="studio-msg-text">
                {p}
              </p>
            ))}
            {expected.length > 0 ? <p className="studio-msg-text j-expect">{expected.join(" ")}</p> : null}
            {entry.truths.map((t, i) => (
              <p key={`t${i}`} className={`j-truth j-truth-${t.tone}`} data-testid="insight-truth">
                {words.text(t.text)}
              </p>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function Section({ section, children }: { section: JournalSection; children: React.ReactNode }) {
  const words = useDayWords();
  const dates = words.simulation
    ? words.range(section.from, section.to)
    : section.from === section.to
      ? formatLocalDate(section.from)
      : `${formatLocalDate(section.from)} — ${formatLocalDate(section.to)}`;
  // A week is reviewed the morning after its days; the header names that morning, so its record does not look misplaced.
  const review = section.week === null ? undefined : section.entries.find((e) => e.weekly && e.date > section.to)?.date;
  return (
    <section className="j-section" data-week={section.week ?? undefined} aria-label={section.week ? `Неделя ${section.week}` : dates}>
      <div className="j-week" data-testid="journal-week">
        {section.week ? `Неделя ${section.week} · ` : ""}
        {dates}
        {review ? ` · разбор ${words.simulation ? words.on(review) : formatLocalDate(review)}` : ""}
      </div>
      {children}
    </section>
  );
}

/** The history sheet: a light list of decisions, not a terminal. The full story stays here, one tap from the brief. */
export function HistorySheet({ work, clientCost, focusWeek = null, onClose, onRollback }: { work: AdsWork; clientCost: SummaryModel["clientCost"]; focusWeek?: number | null; onClose: () => void; onRollback: (item: HistoryItem) => void }) {
  const body = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState(false);
  // The journal is kept oldest first; the sheet reads newest first (insights spec «Лента инсайтов и связь с историей»).
  const sections = useMemo(() => {
    const focused = focusWeek === null ? -1 : work.journal.findIndex((s) => s.week === focusWeek);
    const shown = all || (focused !== -1 && focused < work.journal.length - SHOWN_WEEKS) ? work.journal : work.journal.slice(-SHOWN_WEEKS);
    return [...shown].reverse().map((section) => ({ ...section, entries: [...section.entries].reverse() }));
  }, [work.journal, all, focusWeek]);
  const earlier = !all && work.journal.length > sections.length;

  useEffect(() => {
    const el = body.current;
    if (el === null) return;
    const hash = window.location.hash.replace(/^#/, "");
    const target = focusWeek !== null ? el.querySelector<HTMLElement>(`[data-week="${focusWeek}"]`) : hash.startsWith("log-") ? el.querySelector<HTMLElement>(`#${CSS.escape(hash)}`) : null;
    target?.scrollIntoView?.({ block: "center" });
  }, [focusWeek]);

  return (
    <Drawer open onClose={onClose} closable={{ "aria-label": "Закрыть" }} placement="right" width="min(560px, 100vw)" title="История" className="sheet" styles={{ body: { padding: 0 } }}>
      <div className="sheet-body" data-testid="agent-journal" ref={body}>
        {clientCost.kind === "known" ? (
          <p className="j-clients" data-testid="client-cost">
            Клиенты · {clientCost.clients} · {clientCost.costPerClient === null ? "—" : `${formatRub(clientCost.costPerClient)} за клиента`}
          </p>
        ) : null}
        {work.sim ? <ComparisonNote sim={work.sim} /> : null}
        {sections.length === 0 ? (
          <p className="sheet-empty">Записей пока нет.</p>
        ) : (
          sections.map((s) => (
            <Section key={`${s.week ?? "d"}:${s.from}`} section={s}>
              {s.entries.map((e, i) => {
                const previous = s.entries[i - 1];
                return <Entry key={e.id} entry={e} sameDay={previous !== undefined && previous.date === e.date && previous.from === null && e.from === null} onRollback={onRollback} />;
              })}
            </Section>
          ))
        )}
        {earlier ? (
          <button type="button" className="j-earlier" onClick={() => setAll(true)}>
            Раньше
          </button>
        ) : null}
      </div>
    </Drawer>
  );
}
