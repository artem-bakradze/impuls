import { expect, test } from "@playwright/test";
import { choose, expectStep, fillBudget, fillFirstSteps, login, next, uniqueEmail } from "./helpers";

/**
 * The simulation mode end to end with the test agent: launch without Direct, virtual days, a decision with its insight,
 * the feed with the scenario's truth, rollback, checklist, real launch.
 */
test("an owner runs the simulation, sees the service decide and goes on to a real launch", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, uniqueEmail("simulation"));
  await page.waitForURL("**/wizard");
  await fillFirstSteps(page);
  await fillBudget(page);
  await next(page);
  await expectStep(page, 5, "Как увидят ваши объявления");
  await next(page);

  await expectStep(page, 6, "Подключите Яндекс Директ и запустите");
  await page.getByLabel("Симуляция").check();
  // Step 6 speaks of the chosen way, and the recommended scenario is selected in advance.
  await expectStep(page, 6, "Запустите симуляцию");
  await expect(page.getByLabel("Обычный месяц")).toBeChecked();
  // The template ads give one search ad: the scenario that needs two explains why it is not available.
  await page.getByRole("button", { name: /Другие сценарии/ }).click();
  await expect(page.getByTestId("scenarios")).toContainText("Нужно хотя бы 2 объявления в поиске — сейчас 1");
  await page.getByRole("button", { name: "Запустить симуляцию" }).click();
  await page.waitForURL("**/summary");

  const bar = page.getByTestId("simulation-bar");
  await expect(bar).toContainText("Симуляция — реклама не показывается");
  await expect(bar).not.toContainText("1 день = ");
  // One mark about ads that are not real: the pult, without the stand banner.
  await expect(page.getByTestId("test-mode-banner")).toHaveCount(0);
  const dayNow = async () => Number(/День (\d+)/.exec((await page.getByTestId("simulation-day").textContent()) ?? "")?.[1]);
  // The time stands until the owner steps it: one day from the menu, then a week from the main button.
  expect(await dayNow()).toBe(1);
  await bar.getByRole("button", { name: /Ещё/ }).click();
  await page.getByRole("menuitem", { name: "+1 день" }).click();
  await expect(page.getByTestId("simulation-day")).toContainText("День 2 из 30", { timeout: 60_000 });
  const step = bar.getByTestId("simulation-step-week");
  await expect(step).not.toHaveClass(/ant-btn-loading/);
  await step.click();
  // The week's story opens on «Как сервис принимает решения».
  await page.waitForURL("**/simulation?week=1", { timeout: 150_000 });
  await expect(page.getByTestId("simulation-day")).toContainText("День 9 из 30");
  const story = page.getByTestId("week-story");
  await expect(story).toContainText("Неделя 1");
  await story.getByRole("button", { name: /Показать сразу/ }).click();
  await expect(story.getByTestId("week-scene-decision")).toBeVisible();
  await expect(story.getByTestId("week-rows")).toContainText("На самом деле");
  await page.getByRole("link", { name: "Сводка" }).click();
  await page.waitForURL("**/summary");
  // The summary has no charts: three numbers and the insight feed with the day reviews.
  await expect(page.getByTestId("summary-feed")).toContainText("Разбор", { timeout: 20_000 });
  const firstInsight = page.getByTestId("summary-feed").getByTestId("insight").first();
  await firstInsight.getByRole("button", { name: /На каких данных и что дальше/ }).click();
  await expect(firstInsight).toContainText("На каких данных");
  await expect(page.locator(".ring")).toHaveCount(0);
  // Nothing on the phone screen is wider than the screen.
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.getByRole("link", { name: "Как решает сервис" }).click();
  await page.waitForURL("**/simulation");
  await expect(page.getByTestId("week-story")).toContainText("Неделя 1");
  await expect(page.getByTestId("sim-comparison")).toContainText("Если бы сервис ничего не делал");
  const checklist = page.getByTestId("sim-checklist");
  await expect(checklist).toContainText("Откатите любое изменение в истории");
  // The feed of the run, where an insight about an ad or advertising says what is true in the scenario.
  await expect(page.getByTestId("sim-feed")).toContainText("Разбор");
  await expect(page.getByTestId("insight-truth").first()).toContainText("На самом деле");
  await expect(page.getByTestId("sim-lane")).toHaveCount(0);
  expect(await overflow()).toBeLessThanOrEqual(0);

  // «Вы отменили изменение»: the owner changes the show hours and takes it back from the history, in virtual time.
  await page.getByRole("link", { name: "Настройки" }).click();
  const schedule = page.getByTestId("schedule-section");
  await choose(page, "Показывать до", "до 21:00");
  await page.getByRole("button", { name: "Сохранить время" }).click();
  await expect(schedule).toContainText("Сейчас: Пн–Вс 10:00–21:00");
  await page.getByRole("link", { name: "История" }).click();
  const changed = page.getByTestId("history-entry").filter({ hasText: "Время показа: было Пн–Вс 10:00–20:00 → стало Пн–Вс 10:00–21:00" }).first();
  await changed.getByRole("button", { name: "Вернуть как было" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Вернуть как было" }).click();
  await expect(dialog).toContainText("вернули как было");
  await dialog.getByRole("button", { name: "Понятно" }).click();

  await page.getByRole("link", { name: "Как решает сервис" }).click();
  await page.waitForURL("**/simulation");
  await expect(checklist.locator("li[data-done=true]").filter({ hasText: "Вы отменили изменение" })).toHaveCount(1);

  await bar.getByRole("button", { name: /Ещё/ }).click();
  await page.getByRole("menuitem", { name: "Запустить по-настоящему" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Запустить по-настоящему" }).click();
  await page.waitForURL("**/wizard");
  await expectStep(page, 6, "Подключите Яндекс Директ и запустите");
  await expect(page.getByTestId("simulation-bar")).toHaveCount(0);
});
