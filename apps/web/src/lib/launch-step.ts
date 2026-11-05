import type { AccountMode } from "./account-mode";
import { WIZARD_STEPS } from "./onboarding";

/** What the wizard's last step says, by the account's mode (business-onboarding spec «Превью и запуск»). */
export interface LaunchStepWords {
  title: string;
  lead: string;
  /** Direct only: the owner connects Direct before the launch summary; a demo never sees Direct. */
  connectsDirect: boolean;
  button: string;
  /** The one note before the button (business-onboarding spec «Что будет после запуска»). */
  afterLaunch: string;
}

const HISTORY_PROMISE = "Всё, что он меняет, видно в истории, и почти любое изменение можно вернуть одной кнопкой.";

/**
 * The step has no choice of mode: a demo launches the simulation, an account that signed in with Google or the test
 * login launches in Direct (simulation-mode spec «Режим бизнеса «Симуляция»»).
 */
export const launchStepWords = (mode: AccountMode): LaunchStepWords =>
  mode === "simulation"
    ? {
        title: "Запустите симуляцию",
        lead: "Реклама на учебном рынке, без денег и без Директа: вы вносите цифры за период, а сервис сразу разбирает их и показывает, что заметил и решил.",
        connectsDirect: false,
        button: "Запустить симуляцию",
        afterLaunch: `Дальше откроется «Реклама». Цифры рекламы вы задаёте сами: вносите статистику за выбранный период, а сервис сразу разбирает её и показывает, что заметил и изменил. ${HISTORY_PROMISE}`,
      }
    : {
        title: WIZARD_STEPS[2],
        lead: "Поправьте объявления, если нужно, подключите Яндекс Директ и запустите рекламу.",
        connectsDirect: true,
        button: "Запустить",
        afterLaunch: `Дальше Яндекс проверит объявления — обычно в течение дня. Первые цифры появятся на следующий день, а потом сервис каждое утро смотрит рекламу. ${HISTORY_PROMISE}`,
      };

/** Direct on a stand is a test copy (business-onboarding spec «Ясные действия и режим запуска»). */
export const STAND_DIRECT_TITLE = "На этом стенде Яндекс Директ не подключён";
export const STAND_DIRECT_NOTE = "Здесь доступна только тестовая копия Директа: настоящая реклама не запускается, деньги не списываются.";
