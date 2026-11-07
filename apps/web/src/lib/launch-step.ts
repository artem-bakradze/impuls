import type { AccountMode } from "./account-mode";
import { WIZARD_STEPS } from "./onboarding";

/** What the wizard's last step says, by the account's mode (business-onboarding spec «Превью и запуск»). */
export interface LaunchStepWords {
  title: string;
  /** null: the title says it all. */
  lead: string | null;
  /** Direct only: the owner connects Direct before the launch summary; a demo never sees Direct. */
  connectsDirect: boolean;
  button: string;
  /** The one note before the button (business-onboarding spec «Что будет после запуска»); a demo has none. */
  afterLaunch: string | null;
  /** A real launch warns about counting leads; a demo's training data needs no counter and no note about it. */
  leadsNotice: boolean;
}

const HISTORY_PROMISE = "Всё, что он меняет, видно в истории, и почти любое изменение можно вернуть одной кнопкой.";

/**
 * The step has no choice of mode: a demo launches the simulation, an account that signed in with Google or the test
 * login launches in Direct (simulation-mode spec «Режим бизнеса «Симуляция»»).
 */
export const launchStepWords = (mode: AccountMode): LaunchStepWords =>
  mode === "simulation"
    ? {
        title: "Проверьте объявления",
        lead: null,
        connectsDirect: false,
        button: "Запустить симуляцию",
        afterLaunch: null,
        leadsNotice: false,
      }
    : {
        title: WIZARD_STEPS[2],
        lead: "Поправьте объявления, если нужно, подключите Яндекс Директ и запустите рекламу.",
        connectsDirect: true,
        button: "Запустить",
        afterLaunch: `Дальше Яндекс проверит объявления — обычно в течение дня. Первые цифры появятся на следующий день, а потом сервис каждое утро смотрит рекламу. ${HISTORY_PROMISE}`,
        leadsNotice: true,
      };

/** How many phrases a summary line shows before «все». */
export const SHORT_LIST = 5;

/**
 * A summary line of phrases written with the ads (business-onboarding «Превью и запуск»): the first five and «и ещё N»,
 * the whole list on «все»; `expandable` is false when the short text already says everything. null: no line.
 */
export const phraseList = (list: readonly string[]): { text: string; all: string; expandable: boolean } | null => {
  if (list.length === 0) return null;
  const all = list.join(", ");
  return list.length <= SHORT_LIST
    ? { text: all, all, expandable: false }
    : { text: `${list.slice(0, SHORT_LIST).join(", ")} и ещё ${list.length - SHORT_LIST}`, all, expandable: true };
};

/** Direct on a stand is a test copy (business-onboarding spec «Ясные действия и режим запуска»). */
export const STAND_DIRECT_TITLE = "На этом стенде Яндекс Директ не подключён";
export const STAND_DIRECT_NOTE = "Здесь доступна только тестовая копия Директа: настоящая реклама не запускается, деньги не списываются.";
