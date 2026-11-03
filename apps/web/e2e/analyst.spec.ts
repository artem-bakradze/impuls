import { expect, test } from "@playwright/test";
import { expectStep, fillBudget, fillFirstSteps, login, next, uniqueEmail } from "./helpers";

/**
 * The analyst levers end to end with the test agent (add-agent-analyst-stage1): in «Обычный месяц» people also search
 * for photos and ideas and do not book, so the agent cuts those queries — the journal of «Реклама» shows it with its facts
 * and «Вернуть как было» — and on Monday the journal has «Разбор недели».
 */
test("the test agent cuts a junk query with an insight and reviews the week", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, uniqueEmail("analyst"));
  await page.waitForURL("**/wizard");
  await fillFirstSteps(page);
  await fillBudget(page);
  await next(page);
  await expectStep(page, 3, "Объявления и запуск");
  await page.getByLabel("Симуляция").check();
  await expect(page.getByLabel("Обычный месяц")).toBeChecked();
  await page.getByRole("button", { name: "Запустить симуляцию" }).click();
  await page.waitForURL("**/summary");

  const bar = page.getByTestId("simulation-bar");
  // Two weeks and a Monday's review: the junk queries spend the goal without a client in about ten days, and the
  // breakdowns are the review's job.
  for (const week of [1, 2, 3]) {
    const step = bar.getByTestId("simulation-step-week");
    await expect(step).not.toHaveClass(/ant-btn-loading/);
    await step.click();
    await page.waitForURL(`**/summary?week=${week}`, { timeout: 150_000 });
  }

  const journal = page.getByTestId("agent-journal");
  const negative = journal.getByTestId("journal-change").filter({ hasText: /Убрал показы по запросам .*«(идеи|форум)»/ }).first();
  await expect(negative).toBeVisible();
  await expect(negative.getByRole("button", { name: "Вернуть как было" })).toBeVisible();
  await negative.getByText("Факты").click();
  // The facts name the query's segment of the turn.
  await expect(negative.locator("dl")).toContainText(/запрос/i);
  await expect(journal.getByText("разбор недели").first()).toBeVisible();
  await expect(journal.locator(".log-hypothesis").first()).toBeVisible();
});
