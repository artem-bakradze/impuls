"use client";

import { CheckCircleFilled } from "@ant-design/icons";
import { useLayoutEffect, useRef } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { HistoryItem } from "@/lib/history-view";
import type { AdsWork } from "@/lib/server/simulation-screen";
import { noteExpect, noteSeen, noteSentence, noteTitle } from "@/lib/review-note";
import type { JournalEntry } from "@/lib/service-work";
import { AgentAvatar } from "../ui/AgentAvatar";
import { useDayWords } from "../ui/DayWordsContext";

/** The review is the service's latest entry, not the owner's change or the launch. */
export const latestReview = (work: Pick<AdsWork, "journal">): JournalEntry | null =>
  work.journal
    .flatMap((section) => section.entries)
    .filter((entry) => entry.kind === "agent" || entry.kind === "rules" || entry.kind === "quiet")
    .at(-1) ?? null;

/** Who speaks: the assistant's avatar, its name and what the message is about. The heading is the day of the record. */
function MessageHead({ title }: { title: string }) {
  return (
    <header className="studio-msg-head">
      <span className="studio-avatar">
        <AgentAvatar size={40} />
      </span>
      <span className="studio-msg-who">
        <span className="studio-msg-name">Импульс</span>
        <h2 className="studio-msg-title">{title}</h2>
      </span>
    </header>
  );
}

/** While the day goes, the assistant is typing: running dots in its bubble and the step's line under it. */
function Thinking({ line }: { line: string }) {
  return (
    <div className="studio-thinking" data-testid="studio-thinking">
      <div className="studio-bubble studio-typing" role="status" aria-label="Сервис пишет разбор">
        <i />
        <i />
        <i />
      </div>
      <p className="studio-thinking-line">{line}</p>
    </div>
  );
}

/**
 * The review as the assistant's message, in the service's own words and without section labels (simulation-mode spec
 * «Симуляция как отдельный режим»): the reasoning and what the checks found, each change as a done action with its undo,
 * then what the service expects and when it checks. A review that arrives on the owner's eyes shows part by part; the
 * text is the one already written, and with reduced motion it is all there at once.
 */
function Review({ review, reveal, onRollback, onMore }: { review: JournalEntry; reveal: boolean; onRollback: (item: HistoryItem) => void; onMore: (entryId: string) => void }) {
  const words = useDayWords();
  const seen = noteSeen(review, words);
  const expected = noteExpect(review, words);
  let part = 0;
  const order = () => ({ "--i": part++ }) as CSSProperties;
  const more = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onMore(review.id);
  };
  return (
    <article className={reveal ? "studio-msg studio-msg-reveal" : "studio-msg"} data-testid="studio-review">
      <div className="studio-bubble">
        {seen.map((text, i) => (
          <p key={`seen-${i}`} className="studio-msg-text" style={order()}>
            {text}
          </p>
        ))}
        {review.changes.map((change, i) => {
          const undoable = change.item !== null && !change.reverted && change.item.rollback.kind === "available";
          return (
            <div key={change.historyId ?? `change-${i}`} className="studio-msg-action" data-reverted={change.reverted || undefined} style={order()}>
              <CheckCircleFilled className="studio-msg-done" aria-label={change.reverted ? "отменено" : "сделано"} />
              <span className="studio-msg-action-text">
                {noteSentence(words.text(change.text))}
                {change.reverted ? <span className="studio-msg-dim"> — вы вернули как было</span> : null}.
              </span>
              {undoable ? (
                <button type="button" className="studio-msg-undo" onClick={() => onRollback(change.item as HistoryItem)}>
                  Вернуть как было
                </button>
              ) : null}
            </div>
          );
        })}
        {expected.length > 0 ? (
          <p className="studio-msg-text" style={order()}>
            {expected.join(" ")}
          </p>
        ) : null}
      </div>
      <a className="studio-msg-more" href={`#log-${review.id}`} onClick={more} style={order()}>
        Подробнее — в истории ›
      </a>
    </article>
  );
}

/**
 * The service's review beside the answer (analytics spec «Сводка»), in both modes: the latest record as the assistant's
 * message, the assistant typing while a simulated day goes, or its promise before the first day. «Подробнее — в истории»
 * opens the history sheet on the record.
 */
export function ReviewRail({
  review,
  thinking,
  reveal,
  onRollback,
  onMore,
}: {
  review: JournalEntry | null;
  /** The step's line while a simulated day goes; null otherwise. */
  thinking: string | null;
  /** The review arrived after a step: it is written part by part. */
  reveal: boolean;
  onRollback: (item: HistoryItem) => void;
  onMore: (entryId: string | null) => void;
}) {
  const words = useDayWords();
  const state = thinking !== null ? "thinking" : review !== null ? "review" : "empty";
  // While the assistant types, the rail keeps the height of its last message, so the player under it does not jump.
  const rail = useRef<HTMLElement>(null);
  const height = useRef(0);
  useLayoutEffect(() => {
    const el = rail.current;
    if (el === null) return;
    if (state === "thinking") {
      el.style.minHeight = height.current > 0 ? `${height.current}px` : "";
    } else {
      el.style.minHeight = "";
      height.current = el.offsetHeight;
    }
  }, [state, review]);
  return (
    <aside ref={rail} className="brief-side panel review-rail" aria-label="Разбор" data-state={state} data-testid="review-rail">
      <MessageHead title={thinking !== null ? "Разбирает день" : review === null ? "Разбор дня" : noteTitle(review, words)} />
      {thinking !== null ? (
        <Thinking line={thinking} />
      ) : review !== null ? (
        <Review key={review.id} review={review} reveal={reveal} onRollback={onRollback} onMore={onMore} />
      ) : (
        <div className="studio-msg studio-empty-review">
          <p className="studio-bubble">После первого дня я напишу здесь, что заметил в рекламе и что изменил.</p>
          <button type="button" className="studio-msg-more studio-msg-more-button" onClick={() => onMore(null)}>
            Вся история ›
          </button>
        </div>
      )}
    </aside>
  );
}
