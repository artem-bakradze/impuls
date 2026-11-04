import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { choose, expectStep, fillBudget, fillFirstSteps, login, next, uniqueEmail } from "./helpers";

/**
 * The simulation mode end to end with the test agent: the studio as a separate tab, a day and a week by the owner's
 * press, the review on the right, the brief with one chart, the history with rollback, and a real launch.
 */
test("an owner runs the simulation in the studio and goes on to a real launch", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  await login(page, uniqueEmail("simulation"));
  await page.waitForURL("**/wizard");
  await fillFirstSteps(page);
  await fillBudget(page);
  await next(page);

  await expectStep(page, 3, "Объявления и запуск");
  await page.getByLabel("Симуляция").check();
  await expectStep(page, 3, "Запустите симуляцию");
  await expect(page.getByLabel("Обычный месяц")).toBeChecked();
  await page.getByRole("button", { name: /Другие сценарии/ }).click();
  await expect(page.getByTestId("scenarios")).toContainText("Нужно хотя бы 2 объявления в поиске — сейчас 1");
  await page.getByRole("button", { name: "Запустить симуляцию" }).click();
  await page.waitForURL("**/simulation", { timeout: 150_000 });

  // The simulation is a place with its own tab, not a floating strip over every screen.
  await expect(page.getByTestId("simulation-bar")).toHaveCount(0);
  await expect(page.getByTestId("test-mode-banner")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Разделы" }).getByRole("link")).toHaveText(["Реклама", "Симуляция", "Настройки"]);
  await expect(page.getByTestId("studio-day")).toHaveText("День 1");
  await expect(page.getByTestId("studio-status")).toHaveText("впереди");
  await expect(page.getByTestId("studio-ad")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Прожить день" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Прожить неделю" })).toBeVisible();
  await expect(page.getByTestId("studio-review")).toHaveCount(0);

  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  for (const width of [320, 360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow()).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  // The empty rail is a desktop hint; on a phone the action comes first and the hint is not needed.
  await expect(page.getByText(/После дня здесь появится разбор/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("studio-start.png"), fullPage: true });

  const day = () => page.getByTestId("studio-day").textContent();
  const state = () => page.getByTestId("studio-status").textContent();
  const step = async (button: Locator) => {
    const beforeDay = await day();
    const before = `${beforeDay}|${await state()}`;
    await button.click();
    await expect.poll(async () => `${await day()}|${await state()}`, { timeout: 180_000 }).not.toBe(before);
    await expect(page.getByTestId("studio-review")).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId("studio-status")).toHaveText("прожит");
    // A lived step has moved the day: while a step runs, the day before is never shown as lived.
    expect(await day()).not.toBe(beforeDay);
  };

  // One day by the stage button: the review appears on the right and the next day moves there.
  await step(page.getByRole("button", { name: "Прожить день" }));
  await expect(page.getByRole("button", { name: "Прожить следующий день" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Прожить день" })).toHaveCount(0);

  // A week by the rail: the day strip and the counters move, the review stays a place of its own.
  await step(page.getByRole("button", { name: "Прожить неделю" }));
  await page.screenshot({ path: testInfo.outputPath("studio-review.png"), fullPage: true });

  // The brief: one answer, one chart, the mode mark, no pult.
  await page.getByRole("link", { name: "Реклама" }).click();
  await page.waitForURL("**/summary");
  await expect(page.getByTestId("brief")).toBeVisible();
  await expect(page.locator(".brief-mode")).toHaveText(/^симуляция · день \d+ из 30$/);
  // The numbers name their period, and the service says what it does next.
  await expect(page.getByTestId("data-period")).toHaveText(/^\d+–\d+ \S+$/);
  await expect(page.getByTestId("next-step")).toContainText("Дальше");
  await expect(page.getByTestId("simulation-bar")).toHaveCount(0);
  await expect(page.getByTestId("cost-chart")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Разделы" }).getByRole("link")).toHaveText(["Реклама", "Симуляция", "Настройки"]);
  await expect(page.getByTestId("ads-state")).toContainText("идёт");
  await expect(page.getByTestId("budget-pace")).toContainText(/план|хватит до|бюджет месяца потрачен/);

  // The history is the journal of the brief, with the comparison at its top.
  await page.getByRole("button", { name: /История/ }).click();
  const journal = page.getByTestId("agent-journal");
  await expect(journal.getByTestId("journal-entry").first()).toBeVisible();
  await expect(page.getByTestId("sim-comparison")).toContainText("без него было бы");
  await expect(page.getByTestId("sim-checklist")).toHaveCount(0);
  await expect(page.locator(".results-trend")).toHaveCount(0);
  for (const width of [320, 360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow()).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Закрыть" }).click();

  // The ads are a sheet too.
  await page.getByRole("button", { name: /Объявления/ }).click();
  await expect(page.getByTestId("shown-ad").first()).toBeVisible();
  await expect(page.getByTestId("ad-stats").first()).toContainText("потрачено");
  // Each group says its rule in rubles; leads are not called clients.
  await expect(page.locator(".sheet-group-rule").first()).toContainText("₽");
  for (const heading of await page.getByTestId("shown-ads").locator(".sheet-group").allTextContents()) expect(heading).not.toContain("клиент");
  for (const width of [320, 360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflow()).toBeLessThanOrEqual(0);
  }
  await page.getByRole("button", { name: "Закрыть" }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("brief.png"), fullPage: true });
  expect(await overflow()).toBeLessThanOrEqual(0);

  // The owner changes the show hours and takes it back from the journal, in virtual time.
  await page.setViewportSize({ width: 1280, height: 900 });
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
  const dialog = page.locator(".ant-modal");
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await overflow()).toBeLessThanOrEqual(0);
  await dialog.getByRole("button", { name: "Вернуть как было" }).click();
  await expect(dialog).toContainText("вернули как было");
  await dialog.getByRole("button", { name: "Понятно" }).click();
  await expect(page.getByTestId("agent-journal").getByTestId("journal-change").filter({ hasText: "отменено" })).toHaveCount(1);
  await page.getByRole("button", { name: "Закрыть" }).click();

  // Back to the studio: the real launch is a visible button of its head, not a menu item and not on every screen.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "Симуляция" }).click();
  await page.waitForURL("**/simulation");
  await expect(page.getByTestId("studio-disclaimer")).toHaveText(/Учебный рынок · деньги не списываются/);
  await expect(page.getByTestId("studio-scenario")).toContainText("сценарий «");
  await page.locator(".studio-head").getByRole("button", { name: "Запустить по-настоящему" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Запустить по-настоящему" }).click();
  await page.waitForURL("**/wizard");
  await expectStep(page, 3, "Объявления и запуск");
  await expect(page.getByTestId("simulation-bar")).toHaveCount(0);
});
