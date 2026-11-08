import type { TurnStep } from "@impuls/worker/turn-steps";
import { plain } from "./service-work";

/** How many of the latest steps the review shows under the typing dots. */
export const REVIEW_STEPS_SHOWN = 6;

const CLOSED: Record<Extract<TurnStep, { kind: "hypothesis_closed" }>["status"], string> = {
  confirmed: "подтвердилось",
  rejected: "не подтвердилось",
  dropped: "снял с проверки",
};

/** Names that keep their capital after «Предполагаю:». */
const NAMES = /^(Яндекс|Директ|Метрик|ВКонтакте|Телеграм|Ватсап)/;

/**
 * «С телефонов обращения дороже.» → «с телефонов обращения дороже»: a clause after «Предполагаю:». A name keeps its
 * capital: a Latin word («WhatsApp»), a word with another capital in it, or a name of the list.
 */
const clause = (text: string): string => {
  const trimmed = text.trim().replace(/[.!…]+$/, "");
  const first = trimmed.split(/\s/)[0] ?? "";
  const name = !/^[А-ЯЁ]/.test(first) || /[А-ЯЁA-Z]/.test(first.slice(1)) || NAMES.test(first);
  return name ? trimmed : `${trimmed[0]?.toLowerCase() ?? ""}${trimmed.slice(1)}`;
};

/**
 * The assistant's steps while it reviews a period, in the owner's words (simulation-mode «Ход разбора на глазах
 * владельца»): «Смотрю цифры за дни 9–15», «Предполагаю: …», a change in the history's words. `days` — «дни 9–15» or
 * «день 9»; `headlines` — the history's words of the turn's changes, by change id. A change without words is left out;
 * the same line twice in a row is said once; only the last six are shown.
 */
export const reviewStepLines = (steps: readonly TurnStep[], days: string | null, headlines: ReadonlyMap<string, string>): string[] => {
  const lines: string[] = [];
  for (const step of steps) {
    const line = ((): string | null => {
      switch (step.kind) {
        case "numbers":
          return days === null ? "Смотрю цифры" : `Смотрю цифры за ${days}`;
        case "memory":
          return "Вспоминаю, что уже заметил и что проверяю";
        case "breakdown":
          return step.dimension === "query" ? "Смотрю, по каким запросам показывалась реклама в поиске" : "Смотрю, откуда обращения дешевле — с телефонов или с компьютеров";
        case "hypothesis_saved":
          return `Предполагаю: ${clause(step.statement)}`;
        case "hypothesis_closed":
          return `Проверил: ${clause(step.statement)} — ${CLOSED[step.status]}`;
        case "observation":
          return `Заметил: ${clause(step.text)}`;
        case "change":
          return headlines.get(step.changeId) ?? null;
      }
    })();
    if (line !== null && line !== lines.at(-1)) lines.push(plain(line));
  }
  return lines.slice(-REVIEW_STEPS_SHOWN);
};
