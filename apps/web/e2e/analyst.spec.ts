import { expect, test } from "@playwright/test";
import { expectStep, fillBudget, fillFirstSteps, login, next, uniqueEmail } from "./helpers";

/**
 * The analyst levers end to end with the test agent (add-agent-analyst-stage1): in «Обычный месяц» people also search
 * for photos and ideas and do not book, so the agent cuts those queries — the history shows the negative phrase with
 * «Почему» and «Вернуть как было» — and on Monday the feed shows «Разбор недели».
 */
test("the test agent cuts a junk query with an insight and reviews the week", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, uniqueEmail("analyst"));
  await page.waitForURL("**/wizard");
  await fillFirstSteps(page);
  await fillBudget(page);
  await next(page);
  await expectStep(page, 5, "Как увидят ваши объявления");
  await next(page);
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
    await page.waitForURL(`**/simulation?week=${week}`, { timeout: 150_000 });
  }

  await page.getByRole("link", { name: "История" }).click();
  const negative = page.getByTestId("history-entry").filter({ hasText: /Минус-фразы: было .* → стало .*«идеи»|Минус-фразы: было .* → стало .*«форум»/ }).first();
  await expect(negative).toBeVisible();
  await expect(negative.getByRole("button", { name: "Вернуть как было" })).toBeVisible();
  await negative.getByRole("button", { name: /Почему/ }).click();
  await expect(negative.getByTestId("insight")).toContainText("Добавили минус-фразу");
  // The insight names the query: «По запросу «…» …» when it brought no leads, «Запрос «…» …» otherwise.
  await expect(negative.getByTestId("insight")).toContainText(/[Зз]апрос[уа]? «/);

  await page.goto("/summary?period=month");
  await expect(page.getByTestId("weekly-review").first()).toContainText("Разбор недели");
  await expect(page.getByTestId("weekly-checking").first()).toBeVisible();
});
