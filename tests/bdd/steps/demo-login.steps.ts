import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { accountFromSignIn, accountMode, DEMO_LOGIN_PROVIDER, launchModeFor, TEST_LOGIN_PROVIDER } from "../../../apps/web/src/lib/account-mode";
import type { LaunchModeCheck, NewAccount } from "../../../apps/web/src/lib/account-mode";
import { homePath } from "../../../apps/web/src/lib/home-path";
import { launchStepWords } from "../../../apps/web/src/lib/launch-step";
import { emptyDraft, WIZARD_STEPS, wizardStepOf } from "../../../apps/web/src/lib/onboarding";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("auth/demo-login.feature"), { language: "ru" });

describeFeature(feature, ({ Scenario }) => {
  Scenario("Первый вход в демо", ({ When, Then, And }) => {
    let account: NewAccount;
    When("посетитель без сессии нажимает «Демо-режим»", () => {
      // Auth.js hands the provider a new id per press; nothing else identifies the visitor.
      account = accountFromSignIn(DEMO_LOGIN_PROVIDER, { id: crypto.randomUUID() });
    });
    Then("создаётся демо-аккаунт без email и имени", () => {
      expect(account).toMatchObject({ kind: "demo", email: null, name: null });
      expect(account.subject).toMatch(/^demo:/);
    });
    And("открывается первый шаг мастера «Где вас найти?»", () => {
      // A new account has no business yet.
      expect(homePath(null)).toBe("/wizard");
      expect(WIZARD_STEPS[wizardStepOf(1, emptyDraft()) - 1]).toBe("Где вас найти?");
    });
    And("его реклама будет работать только в симуляции", () => {
      expect(accountMode(account.kind)).toBe("simulation");
    });
  });

  Scenario("Тестовый вход — настоящий режим", ({ When, Then, And }) => {
    let account: NewAccount;
    When("проверяющий на стенде входит тестовым входом по почте и имени", () => {
      account = accountFromSignIn(TEST_LOGIN_PROVIDER, { id: "test:qa@impuls.test", email: "qa@impuls.test", name: "Проверка" });
    });
    Then("аккаунт хранит его почту, а реклама будет работать только в Яндекс Директе", () => {
      expect(account).toMatchObject({ kind: "test", email: "qa@impuls.test" });
      expect(accountMode(account.kind)).toBe("direct");
    });
    And("шаг запуска предлагает подключить Яндекс Директ, а выбора «Симуляция» нет", () => {
      const words = launchStepWords(accountMode(account.kind));
      expect(words.connectsDirect).toBe(true);
      expect(Object.values(words).join(" ")).not.toMatch(/симуляц/i);
    });
  });

  Scenario("Режим не выбирается в мастере", ({ Given, When, Then }) => {
    let launches: LaunchModeCheck[] = [];
    Given("владелец демо и проверяющий с тестовым входом прошли мастер до шага 3", () => undefined);
    When("они нажимают кнопку запуска", () => {
      // Today's page sends no mode: there is nothing to choose.
      launches = [launchModeFor("demo", {}), launchModeFor("test", {})];
    });
    Then("демо запускает симуляцию, а тестовый вход — рекламу в Директе, и выбора между ними ни у кого нет", () => {
      expect(launches).toEqual([
        { ok: true, mode: "simulation" },
        { ok: true, mode: "direct" },
      ]);
      expect(launchStepWords("simulation").connectsDirect).toBe(false);
      expect(launchStepWords("direct").button).toBe("Запустить");
    });
  });

  Scenario("Прежняя страница с выбором режима", ({ Given, When, Then }) => {
    let launch: LaunchModeCheck;
    Given("у проверяющего с тестовым входом открыта страница мастера до обновления, на ней выбрана «Симуляция»", () => undefined);
    When("страница отправляет запуск", () => {
      launch = launchModeFor("test", { simulation: true });
    });
    Then("запуск не выполняется, и проверяющий видит «Мастер обновился — обновите страницу»", () => {
      // The launch route answers 409 with this message and enqueues no job: neither Direct nor the training market.
      expect(launch).toEqual({ ok: false, code: "WIZARD_OUTDATED", message: "Мастер обновился — обновите страницу" });
    });
  });
});
