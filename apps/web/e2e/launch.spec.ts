import { expect, test } from "@playwright/test";
import { expectStep, fillBudget, fillFirstSteps, finishWizard, login, next, uniqueEmail } from "./helpers";

test("new owner signs in, goes through the three wizard steps and launches ads on the simulator", async ({ page }) => {
  const email = uniqueEmail("launch");
  await login(page, email);
  await page.waitForURL("**/wizard");
  await expect(page.getByTestId("test-mode-banner")).toHaveText("Тестовый стенд — Яндекс Директ не подключён, реклама не показывается");

  await fillFirstSteps(page);
  await fillBudget(page);

  // «Назад» from the ads keeps the card and the budget, and the ads written from them.
  await next(page);
  await expectStep(page, 3, "Объявления и запуск");
  await page.getByRole("button", { name: "Назад" }).click();
  await expectStep(page, 2, "Вот как мы вас поняли");
  await expect(page.getByLabel("Бюджет в месяц")).toHaveValue("15 000");

  // Progress is saved: a new visit opens the same step with the same data.
  await page.reload();
  await expectStep(page, 2, "Вот как мы вас поняли");
  await expect(page.getByTestId("auto-goal")).toBeVisible();

  await finishWizard(page);
  await expect(page.getByTestId("first-day")).toContainText("Первые результаты появятся в течение суток");

  // Two sections only; the history is the journal of «Реклама».
  await expect(page.getByRole("navigation", { name: "Разделы" }).getByRole("link")).toHaveText(["Реклама", "Настройки"]);
  await expect(page.getByTestId("agent-journal")).toContainText("Вы: реклама запущена");
  await page.goto("/history");
  await page.waitForURL("**/summary");

  // A returning owner lands on «Реклама», not on the wizard; the old example's address leads home.
  await page.goto("/");
  await page.waitForURL("**/summary");
  await page.goto("/demo");
  await page.waitForURL("**/summary");
});

test("logout returns to the start page and protected pages ask to sign in again", async ({ page }) => {
  await login(page, uniqueEmail("logout"));
  await page.waitForURL("**/wizard");
  await page.getByRole("button", { name: "Выйти" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto("/wizard");
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("button", { name: /Попробовать на своём бизнесе/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Посмотреть на примере" })).toHaveCount(0);
});

test("a cancelled Google login shows the plain message", async ({ page }) => {
  await page.goto("/?error=OAuthCallbackError");
  await expect(page.getByText("Вход отменён. Чтобы продолжить, войдите через Google ещё раз")).toBeVisible();
});
