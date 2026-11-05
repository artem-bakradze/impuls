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
  // Each partner-site ad has its own template picture, drawn after the texts; «Другая картинка» replaces only it.
  await page.getByText(/^Сайты-партнёры · /).click();
  const picture = page.getByTestId("ad-network").first().getByTestId("ad-image");
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1024);
  const first = await picture.getAttribute("src");
  const title = await page.getByTestId("ad-network").first().locator(".ad-title").textContent();
  await page.getByRole("button", { name: "На сайтах-партнёрах Яндекса, объявление 1: другая картинка" }).click();
  await expect(picture).not.toHaveAttribute("src", first ?? "");
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1024);
  await expect(page.getByTestId("ad-network").first().locator(".ad-title")).toHaveText(title ?? "");
  await page.getByRole("button", { name: "Назад" }).click();
  await expectStep(page, 2, "Вот как мы вас поняли");
  await expect(page.getByLabel("Бюджет в месяц")).toHaveValue("15 000");

  // Progress is saved: a new visit opens the same step with the same data.
  await page.reload();
  await expectStep(page, 2, "Вот как мы вас поняли");
  await expect(page.getByTestId("auto-goal")).toBeVisible();

  await finishWizard(page);
  // The first day is a word and a promise, not a timeline.
  await expect(page.getByTestId("first-day")).toContainText("первые данные завтра");

  // Two sections only; the history is a sheet of «Реклама», one tap from the brief.
  await expect(page.getByRole("navigation", { name: "Разделы" }).getByRole("link")).toHaveText(["Реклама", "Настройки"]);
  await page.getByRole("button", { name: /История/ }).click();
  await expect(page.getByTestId("agent-journal")).toContainText("Вы: реклама запущена");
  // The old address of the history opens the history sheet of «Реклама».
  await page.goto("/history");
  await page.waitForURL("**/summary#history");
  await expect(page.getByTestId("agent-journal")).toBeVisible();

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
