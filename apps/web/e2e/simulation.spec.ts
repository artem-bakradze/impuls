import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { choose, expectStep, fillBudget, fillFirstSteps, login, next, uniqueEmail } from "./helpers";

/**
 * The simulation mode end to end with the test agent: one «Реклама» with the player, a period of the owner's own numbers
 * through «Добавить статистику», the assistant's review of it beside the answer, the history with rollback, and a real
 * launch (simulation-mode spec «Статистика периода от владельца»).
 */
test("an owner enters a period of stats in the simulation and goes on to a real launch", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  await login(page, uniqueEmail("simulation"));
  await page.waitForURL("**/wizard");
  await fillFirstSteps(page);
  await fillBudget(page);
  await next(page);

  await expectStep(page, 3, "Объявления и запуск");
  await page.getByLabel("Симуляция").check();
  await expectStep(page, 3, "Запустите симуляцию");
  await expect(page.getByTestId("scenarios")).toHaveCount(0);
  await expect(page.getByText("Обычный месяц")).toHaveCount(0);
  await page.getByRole("button", { name: "Запустить симуляцию" }).click();
  await page.waitForURL("**/summary", { timeout: 150_000 });

  // The simulation is played on «Реклама» itself: two sections, the player with one button.
  await expect(page.getByRole("navigation", { name: "Разделы" }).getByRole("link")).toHaveText(["Реклама", "Настройки"]);
  await expect(page.getByTestId("sim-player")).toBeVisible();
  await expect(page.getByTestId("studio-day")).toHaveText("День 1");
  await expect(page.getByTestId("sim-player")).not.toContainText(/впереди|прожит/);
  await expect(page.getByTestId("sim-player").getByRole("button", { name: "Запустить по-настоящему", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Добавить статистику" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Прожить/ })).toHaveCount(0);
  await expect(page.getByTestId("studio-review")).toHaveCount(0);
  await expect(page.getByText(/Когда вы добавите статистику, я напишу здесь/)).toBeVisible();

  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  for (const width of [320, 360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow()).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // The window: a week from the current day by default, every shown ad with its four numbers, the direction's room.
  await page.getByRole("button", { name: "Добавить статистику" }).click();
  const dialog = page.getByTestId("period-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Статистика за дни 1–7")).toBeVisible();
  const room = Number(((await dialog.getByTestId("period-room").first().textContent()) ?? "").replace(/\D+/g, " ").trim().split(" ")[0] ?? "0");
  expect(room).toBeGreaterThan(0);
  const firstAd = dialog.getByTestId("period-ad").first();
  const field = (label: string) => firstAd.getByLabel(label, { exact: true });

  // A mistake is said under its field, and nothing is sent.
  await field("Показы").fill("50");
  await field("Переходы").fill("60");
  await field("Расход, ₽").fill("100");
  await page.getByTestId("period-send").click();
  await expect(dialog).toContainText("Переходов не может быть больше, чем показов");
  await expect(page.getByTestId("studio-day")).toHaveText("День 1");
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow()).toBeLessThanOrEqual(0);
  }
  await page.screenshot({ path: testInfo.outputPath("period-dialog.png"), fullPage: true });

  // The owner's week: the dialog closes, the service reviews the period, the day moves to the morning after it.
  const spend = Math.max(1, Math.floor(room / 2));
  await field("Показы").fill("1400");
  await field("Переходы").fill("70");
  await field("Обращения").fill("3");
  await field("Расход, ₽").fill(String(spend));
  await page.getByTestId("period-send").click();
  await expect(dialog).toHaveCount(0);
  await lived(page, "День 8");
  await expect(page.getByRole("heading", { level: 2, name: "Разбор · дни 1–7" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("period-review.png"), fullPage: true });

  // The answer: no period over the number (the player says the day), the state without a count, no month.
  await expect(page.getByTestId("brief")).toBeVisible();
  await expect(page.getByTestId("data-period")).toHaveCount(0);
  await expect(page.getByTestId("ads-state")).toHaveText("реклама активна");
  await expect(page.getByTestId("review-rail")).not.toContainText(/января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря/);

  // The history: the period as its section, without a comparison with a control run.
  await page.getByRole("button", { name: /История/ }).click();
  const journal = page.getByTestId("agent-journal");
  await expect(journal.getByTestId("journal-week").first()).toHaveText(/^Дни 1–7 · разбор в день 8$/);
  await expect(page.getByTestId("sim-comparison")).toHaveCount(0);
  await expect(journal).not.toContainText(/без него было бы|На самом деле/);
  await page.getByRole("button", { name: "Закрыть" }).click();

  // The ads sheet shows what was entered.
  await page.getByRole("button", { name: /Объявления/ }).click();
  await expect(page.getByTestId("ad-stats").first()).toContainText("потрачено");
  await page.getByRole("button", { name: "Закрыть" }).click();

  // The owner changes the show hours and takes it back from the history, in virtual time.
  await page.getByRole("link", { name: "Настройки" }).click();
  await page.getByRole("button", { name: "Изменить: Когда показываем" }).click();
  const schedule = page.locator("#where");
  await choose(page, "Показывать до", "до 21:00");
  await page.getByRole("button", { name: "Сохранить время" }).click();
  await expect(schedule).toContainText("Пн–Вс 10:00–21:00");
  await page.getByRole("link", { name: "Реклама" }).click();
  await page.getByRole("button", { name: /История/ }).click();
  const changed = page.getByTestId("agent-journal").getByTestId("journal-change").filter({ hasText: "время показа: было Пн–Вс 10:00–20:00 → стало Пн–Вс 10:00–21:00" }).first();
  await changed.getByRole("button", { name: "Вернуть как было" }).click();
  const modal = page.locator(".ant-modal");
  await modal.getByRole("button", { name: "Вернуть как было" }).click();
  await expect(modal).toContainText("вернули как было");
  await modal.getByRole("button", { name: "Понятно" }).click();
  await page.getByRole("button", { name: "Закрыть" }).click();

  // «Заполнить примерно»: plausible numbers of one day the window accepts, sent as they are.
  await page.getByRole("button", { name: "Добавить статистику" }).click();
  await dialog.getByText("1 день").click();
  await expect(page.getByText("Статистика за день 8")).toBeVisible();
  await page.getByTestId("period-fill").click();
  await expect(field("Показы")).not.toHaveValue("");
  await expect(field("Расход, ₽")).not.toHaveValue("");
  await page.getByTestId("period-send").click();
  await lived(page, "День 9");
  await expect(page.getByRole("heading", { level: 2, name: "Разбор дня · день 8" })).toBeVisible();

  // The old address of the studio opens «Реклама»; the real launch is in the player's menu.
  await page.goto("/simulation");
  await page.waitForURL("**/summary");
  await expect(page.getByTestId("studio-disclaimer")).toHaveText(/Учебный рынок · деньги не списываются/);
  await page.getByRole("button", { name: /^Ещё/ }).click();
  await page.getByRole("menuitem", { name: "Запустить по-настоящему" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Запустить по-настоящему" }).click();
  await page.waitForURL("**/wizard");
  await expectStep(page, 3, "Объявления и запуск");
});

/** Waits until the period is reviewed: the player is on `day` and offers the next period, and the review is there. */
const lived = async (page: Page, day: string) => {
  await expect(page.getByTestId("studio-day")).toHaveText(day, { timeout: 180_000 });
  await expect(page.getByRole("button", { name: "Добавить статистику" })).toBeEnabled({ timeout: 180_000 });
  await expect(page.getByTestId("studio-review")).toBeVisible({ timeout: 180_000 });
};
