import { expect, test } from "@playwright/test";
import { choose, expectStep, fillBudget, fillFirstSteps, login, next, uniqueEmail } from "./helpers";
import type { SimulationStatus } from "../src/lib/simulation-model";

/**
 * The simulation mode end to end with the test agent: launch without Direct, virtual days, a decision with its insight,
 * the feed with the scenario's truth, rollback, checklist, real launch.
 */
test("an owner runs the simulation, sees the service decide and goes on to a real launch", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await login(page, uniqueEmail("simulation"));
  await page.waitForURL("**/wizard");
  await fillFirstSteps(page);
  await fillBudget(page);
  await next(page);

  await expectStep(page, 3, "Объявления и запуск");
  await page.getByLabel("Симуляция").check();
  // The last step speaks of the chosen way, and the recommended scenario is selected in advance.
  await expectStep(page, 3, "Запустите симуляцию");
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
  const actual = await (await page.request.get("/api/simulation")).json() as SimulationStatus;
  for (const [stateIndex, state] of [
    { ...actual, status: "paused" },
    { ...actual, status: "stepping", step: { kind: "week", week: 1 }, agentTurn: { day: 7, weekly: true } },
    { ...actual, status: "paused", failed: true },
    { ...actual, status: "paused", ended: true, daysLeft: 0 },
  ].entries()) {
    await page.route("**/api/simulation", async (route) => {
      if (route.request().method() === "GET") await route.fulfill({ json: state });
      else await route.continue();
    });
    await expect.poll(async () => bar.getByTestId("simulation-progress").textContent()).toContain(state.failed ? "Расчёт прерван" : state.status === "stepping" ? "Сервис разбирает неделю" : "Время стоит");
    for (const width of [320, 360, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      await expect(bar.getByText("Симуляция", { exact: true })).toBeVisible({ visible: width < 720 });
      if (width < 720) {
        const box = await bar.getByRole("button", { name: /Ещё/ }).boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44); expect(box?.height).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: testInfo.outputPath(`pult-${stateIndex}-${width}.png`) });
      }
    }
    await page.unroute("**/api/simulation");
  }
  await page.reload();
  await page.setViewportSize({ width: 360, height: 900 });
  await bar.getByRole("button", { name: /Ещё/ }).click();
  await page.getByRole("menuitem", { name: "+1 день" }).click();
  await expect(page.getByTestId("simulation-day")).toContainText("День 2 из 30", { timeout: 60_000 });
  const step = bar.getByTestId("simulation-step-week");
  await expect(step).not.toHaveClass(/ant-btn-loading/);
  await step.click();
  // The lived week opens on «Реклама»: the month's numbers, the ads shown now and the agent's journal on that week.
  await page.waitForURL("**/summary?week=1", { timeout: 150_000 });
  await expect(page.getByTestId("simulation-day")).toContainText("День 9 из 30");
  await expect(page.getByTestId("shown-ad").first()).toBeVisible();
  const journal = page.getByTestId("agent-journal");
  await expect(journal.getByRole("region", { name: "Неделя 1" })).toBeVisible();
  await expect(journal.getByTestId("journal-entry").first()).toBeVisible();
  await expect(page.getByTestId("sim-comparison")).toContainText("без него было бы");
  await expect(page.getByTestId("sim-checklist")).toHaveCount(0);
  await expect(page.locator(".results-trend")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Разделы" }).getByRole("link")).toHaveText(["Реклама", "Настройки"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(journal.getByTestId("journal-entry").last().locator(".log-caret")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("ads-reduced-motion.png"), fullPage: true });
  // Nothing on the phone screen is wider than the screen.
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  // The old address of the decisions screen opens «Реклама».
  await page.goto("/simulation");
  await page.waitForURL("**/summary");

  // The owner changes the show hours and takes it back from the journal, in virtual time.
  await page.getByRole("link", { name: "Настройки" }).click();
  for (const width of [320, 360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  await page.getByRole("button", { name: "Изменить: Когда показываем" }).click();
  const schedule = page.locator("#where");
  await choose(page, "Показывать до", "до 21:00");
  await page.getByRole("button", { name: "Сохранить время" }).click();
  await expect(schedule).toContainText("Пн–Вс 10:00–21:00");
  await page.getByRole("link", { name: "Реклама" }).click();
  const changed = page.getByTestId("agent-journal").getByTestId("journal-change").filter({ hasText: "время показа: было Пн–Вс 10:00–20:00 → стало Пн–Вс 10:00–21:00" }).first();
  await changed.getByRole("button", { name: "Вернуть как было" }).click();
  const dialog = page.getByRole("dialog");
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await dialog.getByRole("button", { name: "Вернуть как было" }).click();
  await expect(dialog).toContainText("вернули как было");
  await dialog.getByRole("button", { name: "Понятно" }).click();

  await expect(page.getByTestId("agent-journal").getByTestId("journal-change").filter({ hasText: "отменено" })).toHaveCount(1);

  await bar.getByRole("button", { name: /Ещё/ }).click();
  await page.getByRole("menuitem", { name: "Запустить по-настоящему" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Запустить по-настоящему" }).click();
  await page.waitForURL("**/wizard");
  await expectStep(page, 3, "Объявления и запуск");
  await expect(page.getByTestId("simulation-bar")).toHaveCount(0);
});
