import { expect, test } from "@playwright/test";
import { expectStep, fillBudget, fillFirstSteps, finishWizard, login, next, uniqueEmail } from "./helpers";

test("new owner signs in, goes through the wizard and launches ads on the simulator", async ({ page }) => {
  const email = uniqueEmail("launch");
  await login(page, email);
  await page.waitForURL("**/wizard");
  await expect(page.getByTestId("test-mode-banner")).toHaveText("Тестовый стенд — Яндекс Директ не подключён, реклама не показывается");

  await fillFirstSteps(page);
  await fillBudget(page);

  // «Назад» keeps the answers of this and later steps.
  await page.getByRole("button", { name: "Назад" }).click();
  await expectStep(page, 3, "Что для вас клиент?");
  await expect(page.getByLabel("Звонок по номеру с сайта")).toBeChecked();
  await next(page);
  await expectStep(page, 4, "Бюджет");
  await expect(page.getByLabel("Бюджет в месяц")).toHaveValue("15 000");

  // Progress is saved: a new visit opens the same step with the same data.
  await page.getByRole("button", { name: "Назад" }).click();
  await next(page);
  await page.reload();
  await expectStep(page, 4, "Бюджет");
  await expect(page.getByTestId("auto-goal")).toBeVisible();

  await finishWizard(page);
  await expect(page.getByTestId("first-day")).toContainText("Первые результаты появятся в течение суток");

  await page.getByRole("link", { name: "История" }).click();
  await expect(page.getByText("Реклама запущена.", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Запуск нельзя отменить, но рекламу можно поставить на паузу в настройках.")).toBeVisible();

  // A returning owner lands on the summary, not on the wizard.
  await page.goto("/");
  await page.waitForURL("**/summary");
});

test("logout returns to the start page and protected pages ask to sign in again", async ({ page }) => {
  await login(page, uniqueEmail("logout"));
  await page.waitForURL("**/wizard");
  await page.getByRole("button", { name: "Выйти" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto("/wizard");
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("button", { name: "Войти через Google" })).toBeVisible();
});

test("a cancelled Google login shows the plain message", async ({ page }) => {
  await page.goto("/?error=OAuthCallbackError");
  await expect(page.getByText("Вход отменён. Чтобы продолжить, войдите через Google ещё раз")).toBeVisible();
});
