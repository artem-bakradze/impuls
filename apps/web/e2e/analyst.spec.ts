import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { expectStep, fillBudget, fillFirstSteps, login, next, uniqueEmail } from "./helpers";

/**
 * The analyst levers end to end with the test agent (add-agent-analyst-stage1): in «Обычный месяц» people also search
 * for photos and ideas and do not book, so the agent cuts those queries — the studio shows the week's review, and the
 * history shows the change with its facts and «Вернуть как было».
 */
test("the test agent cuts a junk query with an insight and reviews the week", async ({ page }) => {
  test.setTimeout(360_000);
  await login(page, uniqueEmail("analyst"));
  await page.waitForURL("**/wizard");
  await fillFirstSteps(page);
  await fillBudget(page);
  await next(page);
  await expectStep(page, 3, "Объявления и запуск");
  await page.getByLabel("Симуляция").check();
  await expect(page.getByLabel("Обычный месяц")).toBeChecked();
  await page.getByRole("button", { name: "Запустить симуляцию" }).click();
  await page.waitForURL("**/simulation", { timeout: 150_000 });

  const day = () => page.getByTestId("studio-day").textContent();
  const state = () => page.getByTestId("studio-status").textContent();
  const step = async (button: Locator) => {
    const before = `${await day()}|${await state()}`;
    await button.click();
    await expect.poll(async () => `${await day()}|${await state()}`, { timeout: 180_000 }).not.toBe(before);
    await expect(page.getByTestId("studio-review")).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId("studio-status")).toHaveText("прожит");
  };

  // Three weeks and a Monday's review: the junk queries spend the goal without a client in about ten days.
  for (let week = 0; week < 3; week++) {
    await step(page.getByRole("button", { name: /Прожить неделю/ }));
  }

  await page.getByRole("link", { name: "Реклама" }).click();
  await page.waitForURL("**/summary");
  await page.getByRole("button", { name: /История/ }).click();
  const journal = page.getByTestId("agent-journal");
  const negative = journal.getByTestId("journal-change").filter({ hasText: /Убрал показы по запросам .*«(идеи|форум)»/ }).first();
  await expect(negative).toBeVisible();
  await expect(negative.getByRole("button", { name: "Вернуть как было" })).toBeVisible();
  await negative.getByText("Факты").click();
  await expect(negative.locator("dl")).toContainText(/запрос/i);
  await expect(journal.getByText("разбор недели").first()).toBeVisible();
  await expect(journal.locator(".log-hypothesis").first()).toBeVisible();
});
