import { expect, test } from "@playwright/test";
import { choose, launchNewBusiness } from "./helpers";

test("changing show hours goes to every campaign and can be rolled back from the history", async ({ page }) => {
  await launchNewBusiness(page, "hours");

  await page.getByRole("link", { name: "Настройки" }).click();
  const schedule = page.getByTestId("schedule-section");
  await expect(schedule).toContainText("Сейчас: Пн–Вс 10:00–20:00");
  await choose(page, "Показывать до", "до 21:00");
  await page.getByRole("button", { name: "Сохранить время" }).click();
  await expect(schedule).toContainText("Расписание показов обновлено во всех кампаниях");
  await expect(schedule).toContainText("Сейчас: Пн–Вс 10:00–21:00");

  await page.getByRole("link", { name: "История" }).click();
  await choose(page, "Кто сделал", "Сделали вы");
  const changes = page.getByTestId("history-entry").filter({ hasText: "Время показа: было «Пн–Вс 10:00–20:00» → стало «Пн–Вс 10:00–21:00»" });
  await expect(changes).toHaveCount(2);

  const first = changes.first();
  await first.getByRole("button", { name: "Вернуть как было" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("rollback-consequences")).toContainText("Вернётся прежнее расписание показов");
  await dialog.getByRole("button", { name: "Вернуть как было" }).click();
  await expect(dialog).toContainText("Готово — вернули как было");
  await dialog.getByRole("button", { name: "Понятно" }).click();

  const reverted = page.getByTestId("history-entry").filter({ hasText: "Время показа: было «Пн–Вс 10:00–21:00» → стало «Пн–Вс 10:00–20:00»" });
  await expect(reverted).toHaveCount(1);
  await expect(reverted).toContainText("Вы отменили изменение");
  await expect(page.getByTestId("history-entry").filter({ hasText: "Отменено" })).toHaveCount(1);
});

test("pause and resume all ads from the settings", async ({ page }) => {
  await launchNewBusiness(page, "pause");
  await page.getByRole("link", { name: "Настройки" }).click();
  await page.getByRole("button", { name: "Поставить рекламу на паузу" }).click();
  await expect(page.getByText("Реклама на паузе", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Сводка" }).click();
  await expect(page.getByText("Реклама на паузе", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Возобновить" }).click();
  await expect(page.getByText("Реклама снова работает")).toBeVisible();
});
