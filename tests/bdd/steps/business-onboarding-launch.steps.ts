import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { accountMode } from "../../../apps/web/src/lib/account-mode";
import { launchStepWords, STAND_DIRECT_NOTE, STAND_DIRECT_TITLE } from "../../../apps/web/src/lib/launch-step";
import type { LaunchStepWords } from "../../../apps/web/src/lib/launch-step";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("business-onboarding/launch-step.feature"), { language: "ru" });

const said = (words: LaunchStepWords): string => [words.title, words.lead, words.button, words.afterLaunch].join(" ");

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
    let note = "";
    When("владелец демо доходит до кнопки «Запустить симуляцию»", () => {
      note = launchStepWords(accountMode("demo")).afterLaunch;
    });
    Then("заметка у кнопки говорит, что цифры рекламы он задаёт сам и откроется «Реклама»", () => {
      expect(note).toContain("Цифры рекламы вы задаёте сами");
      expect(note).toContain("откроется «Реклама»");
    });
    And("после каждой внесённой статистики видно, что сервис заметил и изменил, а изменения видны в истории", () => {
      expect(note).toContain("сервис сразу разбирает её и показывает, что заметил и изменил");
      expect(note).toContain("видно в истории");
    });
  });
});
