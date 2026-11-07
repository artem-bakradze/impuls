import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { accountMode } from "../../../apps/web/src/lib/account-mode";
import { launchStepWords, phraseList, STAND_DIRECT_NOTE, STAND_DIRECT_TITLE } from "../../../apps/web/src/lib/launch-step";
import type { LaunchStepWords } from "../../../apps/web/src/lib/launch-step";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("business-onboarding/launch-step.feature"), { language: "ru" });

const said = (words: LaunchStepWords): string => [words.title, words.lead ?? "", words.button, words.afterLaunch ?? ""].join(" ");

describeFeature(feature, ({ Scenario }) => {
  Scenario("Шаг 6 говорит о выбранном способе", ({ When, Then, And }) => {
    let words: LaunchStepWords;
    When("владелец демо доходит до шага «Объявления и запуск»", () => {
      words = launchStepWords(accountMode("demo"));
    });
    Then("шаг не предлагает подключить Директ, а пояснения не упоминают его баланс", () => {
      expect(words.connectsDirect).toBe(false);
      expect(said(words)).not.toMatch(/баланс|Подключите Яндекс Директ|подключите Яндекс Директ/);
    });
    And("выбора сценария нет, а кнопка называется «Запустить симуляцию»", () => {
      expect(said(words)).not.toMatch(/сценари/i);
      expect(words.button).toBe("Запустить симуляцию");
    });
  });

  Scenario("Шаг запуска у аккаунта Google", ({ When, Then, And }) => {
    let words: LaunchStepWords;
    When("пользователь с тестовым входом доходит до шага «Объявления и запуск»", () => {
      words = launchStepWords(accountMode("test"));
    });
    Then("шаг предлагает подключить Яндекс Директ, а кнопка называется «Запустить»", () => {
      expect(words.connectsDirect).toBe(true);
      expect(words.lead).toContain("подключите Яндекс Директ");
      expect(words.button).toBe("Запустить");
    });
    And("«Симуляция» на шаге не упоминается", () => {
      expect(said(words)).not.toMatch(/симуляц/i);
    });
  });

  Scenario("Тестовая копия Директа на стенде", ({ When, Then, And }) => {
    let shown = "";
    When("на локальном стенде пользователь с тестовым входом доходит до шага запуска", () => {
      // The step connects Direct, and on a stand Direct is the test copy (the wizard's Direct block in simulator mode).
      expect(launchStepWords(accountMode("test")).connectsDirect).toBe(true);
      shown = `${STAND_DIRECT_TITLE}. ${STAND_DIRECT_NOTE}`;
    });
    Then("шаг прямо говорит, что используется тестовая копия Директа и настоящая реклама недоступна", () => {
      expect(shown).toContain("тестовая копия Директа");
      expect(shown).toContain("настоящая реклама не запускается");
    });
    And("не предлагает выбрать «Симуляция»", () => {
      expect(shown).not.toMatch(/Симуляция|симуляц/);
    });
  });

  Scenario("Запуск симуляции", ({ When, Then, And }) => {
    let words: LaunchStepWords;
    When("владелец демо доходит до кнопки «Запустить симуляцию»", () => {
      words = launchStepWords(accountMode("demo"));
    });
    Then("шаг называется «Проверьте объявления», без пояснения под заголовком", () => {
      expect(words.title).toBe("Проверьте объявления");
      expect(words.lead).toBeNull();
    });
    And("у кнопки нет заметки о том, что будет дальше", () => {
      expect(words.afterLaunch).toBeNull();
    });
  });

  Scenario("Демо без строки и заметки об обращениях", ({ When, Then, And }) => {
    let words: LaunchStepWords;
    When("владелец демо дошёл до итога перед запуском", () => {
      words = launchStepWords(accountMode("demo"));
    });
    Then("в итоге нет строки «Что считаем обращением» и заметки об учёте обращений: обращения он вносит сам", () => {
      expect(words.measuresLeads).toBe(false);
      expect(said(words)).not.toMatch(/учебн|счётчик|Метрик/i);
    });
    And("при настоящем запуске строка и предупреждение о счётчике остаются", () => {
      expect(launchStepWords(accountMode("test")).measuresLeads).toBe(true);
    });
  });

  Scenario("Запросы и слова-исключения в итоге", ({ When, Then, And }) => {
    const phrases = Array.from({ length: 16 }, (_, i) => `маникюр ${i + 1}`);
    let search: ReturnType<typeof phraseList>;
    let excluded: ReturnType<typeof phraseList>;
    When("к объявлениям написано 16 поисковых фраз и 2 слова-исключения, «бесплатно» и «обучение»", () => {
      search = phraseList(phrases);
      excluded = phraseList(["бесплатно", "обучение"]);
    });
    Then("строка «По каким запросам показываем в поиске» показывает первые пять фраз и «и ещё 11», а по «все» — все 16", () => {
      expect(search).toEqual({ text: "маникюр 1, маникюр 2, маникюр 3, маникюр 4, маникюр 5 и ещё 11", all: phrases.join(", "), expandable: true });
    });
    And("строка «Не показываем по запросам со словами» — «бесплатно, обучение» без ссылки «все»", () => {
      expect(excluded).toEqual({ text: "бесплатно, обучение", all: "бесплатно, обучение", expandable: false });
    });
    And("без фраз строки нет", () => {
      expect(phraseList([])).toBeNull();
    });
  });
});
