import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { choose, expectStep, fillBudget, fillFirstSteps, loginAsDemo, next } from "./helpers";

/**
 * The simulation mode end to end with the test agent, entered through «Демо-режим»: the wizard without a choice of mode,
 * one «Реклама» with the player, a period of the owner's own numbers through «Добавить статистику», the assistant's
 * review of it beside the answer, the history with rollback, «Новая кампания» and leaving the demo (simulation-mode spec
 * «Статистика периода от владельца», demo-login).
 */
test("a demo's owner enters a period of stats in the simulation and starts a new campaign", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  await loginAsDemo(page);
  await fillFirstSteps(page);
  await fillBudget(page);
  await next(page);

  // The demo's mode is the simulation: no choice of mode, no Direct to connect.
  await expectStep(page, 3, "Проверьте объявления");
  await expect(page.getByLabel("Симуляция")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Продолжить в тестовом режиме" })).toHaveCount(0);
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
  // The search direction by its name: directions come in the order of their random ids, and only search has the junk
  // query. «до 2 700 ₽ за 7 дней»: the thousands are split by a no-break space.
  const search = dialog.getByRole("region", { name: /— Поиск$/ });
  const room = Number(/до\s([\d\s]+)₽/.exec((await search.getByTestId("period-room").textContent()) ?? "")?.[1]?.replace(/\D/g, "") ?? "0");
  expect(room).toBeGreaterThan(100);
  const firstAd = search.getByTestId("period-ad").first();
  const field = (label: string) => firstAd.getByLabel(label, { exact: true });

  // «Что ещё было за эти дни»: a quarter of the week went on a junk query (simulation-breakdowns).
  const junk = dialog.getByRole("checkbox", { name: "Часть денег ушла на ненужный запрос" });
  await expect(junk).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "С телефонов обращаются хуже" })).not.toBeChecked();
  await junk.check();

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

  // The owner's week: the dialog closes, the service reviews the period, the day moves to the morning after it. The
  // whole room is spent, so the junk query's quarter is above the goal and the service takes it away.
  const spend = room;
  await field("Показы").fill("1400");
  await field("Переходы").fill("70");
  await field("Обращения").fill("3");
  await field("Расход, ₽").fill(String(spend));
  await expect(search.getByTestId("period-market-line").first()).toHaveText(/^Около [\d\s]+₽ из [\d\s]+₽ — на запрос «.+ фото», без обращений$/);
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
  // The service took the junk query away by the breakdown, and it can be taken back.
  const negative = journal.getByTestId("journal-change").filter({ hasText: "Убрал показы по запросам «фото»" }).first();
  await expect(negative.getByRole("button", { name: "Вернуть как было" })).toBeVisible();
  await page.getByRole("button", { name: "Закрыть" }).click();

  // The ads sheet shows what was entered, and the partner-site ads with their pictures.
  await page.getByRole("button", { name: /Объявления/ }).click();
  await expect(page.getByTestId("ad-stats").first()).toContainText("потрачено");
  const sheetPicture = page.getByTestId("ad-row-image").first();
  await expect(sheetPicture).toBeVisible();
  await expect.poll(() => sheetPicture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1024);
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
  // The mark stays from the last period, and the window says the junk query is not shown any more.
  await expect(dialog.getByRole("checkbox", { name: "Часть денег ушла на ненужный запрос" })).toBeChecked();
  await expect(search.getByTestId("period-market-line").first()).toHaveText(/^Реклама уже не показывается по запросу «.+ фото»$/);
  await page.getByTestId("period-fill").click();
  await expect(field("Показы")).not.toHaveValue("");
  await expect(field("Расход, ₽")).not.toHaveValue("");
  await page.getByTestId("period-send").click();
  await lived(page, "День 9");
  await expect(page.getByRole("heading", { level: 2, name: "Разбор дня · день 8" })).toBeVisible();

  // The old address of the studio opens «Реклама»; the player's menu has no real launch, a demo has no real ads.
  await page.goto("/simulation");
  await page.waitForURL("**/summary");
  await expect(page.getByTestId("studio-disclaimer")).toHaveText(/Учебный рынок · деньги не списываются/);
  await page.getByRole("button", { name: /^Ещё/ }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Начать заново", "Новая кампания"]);

  // «Новая кампания»: everything goes and the preparation starts from the site; the next launch is a simulation again.
  await page.getByRole("menuitem", { name: "Новая кампания" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Начать новую кампанию" }).click();
  await page.waitForURL("**/wizard");
  await expectStep(page, 1, "Где вас найти?");
  await expect(page.getByLabel("Ваш сайт")).toHaveValue("");

  // Leaving the demo asks first: there is no way back into it.
  await page.getByRole("banner").getByRole("button", { name: /Выйти/ }).click();
  const leave = page.getByRole("dialog");
  await expect(leave).toContainText("Если выйти, вернуться в это демо не получится");
  await leave.getByRole("button", { name: "Остаться" }).click();
  await expect(page).toHaveURL(/\/wizard$/);
  await page.getByRole("banner").getByRole("button", { name: /Выйти/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Выйти" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("button", { name: "Демо-режим" })).toBeVisible();
});

/** Waits until the period is reviewed: the player is on `day` and offers the next period, and the review is there. */
const lived = async (page: Page, day: string) => {
  await expect(page.getByTestId("studio-day")).toHaveText(day, { timeout: 180_000 });
  await expect(page.getByRole("button", { name: "Добавить статистику" })).toBeEnabled({ timeout: 180_000 });
  await expect(page.getByTestId("studio-review")).toBeVisible({ timeout: 180_000 });
};
