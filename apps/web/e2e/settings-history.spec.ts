import { expect, test } from "@playwright/test";
import { choose, launchNewBusiness } from "./helpers";

test("changing show hours goes to every campaign and can be rolled back from the history", async ({ page }) => {
  await launchNewBusiness(page, "hours");

  await page.getByRole("link", { name: "Настройки" }).click();
  // «Сайт»: the owner's own site, no mini-site form (the mini-site is out of the MVP).
  await expect(page.getByText("Объявления ведут на ваш сайт:")).toBeVisible();
  await expect(page.getByRole("link", { name: "https://nogotok.example" })).toBeVisible();
  await expect(page.getByTestId("minisite-form")).toHaveCount(0);
  const schedule = page.getByTestId("schedule-section");
  await expect(schedule).toContainText("Сейчас: Пн–Вс 10:00–20:00");
  await choose(page, "Показывать до", "до 21:00");
  await page.getByRole("button", { name: "Сохранить время" }).click();
  await expect(schedule).toContainText("Расписание обновлено во всей рекламе");
  await expect(schedule).toContainText("Сейчас: Пн–Вс 10:00–21:00");

  await page.getByRole("link", { name: "История" }).click();
  // One feed without filters (simplify-mvp-scope).
  await expect(page.getByLabel("Кто сделал")).toHaveCount(0);
  const changes = page.getByTestId("history-entry").filter({ hasText: "Время показа: было Пн–Вс 10:00–20:00 → стало Пн–Вс 10:00–21:00" });
  await expect(changes).toHaveCount(2);

  const first = changes.first();
  await first.getByRole("button", { name: "Вернуть как было" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("rollback-consequences")).toContainText("Вернётся прежнее расписание показов");
  await dialog.getByRole("button", { name: "Вернуть как было" }).click();
  await expect(dialog).toContainText("Готово — вернули как было");
  await dialog.getByRole("button", { name: "Понятно" }).click();

  const reverted = page.getByTestId("history-entry").filter({ hasText: "Время показа: было Пн–Вс 10:00–21:00 → стало Пн–Вс 10:00–20:00" });
  await expect(reverted).toHaveCount(1);
  await expect(reverted).toContainText("Вы отменили изменение");
  await expect(page.getByTestId("history-entry").filter({ hasText: "Отменено" })).toHaveCount(1);
});

test("the owner sets an own cost per lead, edits the business card and sees how to delete the account", async ({ page }) => {
  await launchNewBusiness(page, "goal");
  await page.getByRole("link", { name: "Настройки" }).click();
  await expect(page.getByText("Спрашивать перед крупными изменениями")).toHaveCount(0);
  const goal = page.getByTestId("goal-section");
  await expect(goal).toContainText("подбираем сами по результатам рекламы");
  await goal.getByRole("radio", { name: "Укажу сумму" }).click();
  await page.getByLabel("Цена одного обращения").fill("500");
  await goal.getByRole("button", { name: "Сохранить цель" }).click();
  await expect(goal).toContainText("Цель сохранена");
  await expect(goal).toContainText("Сейчас: до 500 ₽ за обращение");
  await expect(page.getByTestId("account-deletion")).toContainText("support@impuls.test");

  // «Что рекламируем» is editable; the running ads stay as they are.
  const card = page.getByTestId("card-section");
  await card.getByRole("button", { name: "Изменить описание" }).click();
  await card.getByLabel("Преимущество 1").fill("Работаем без выходных");
  await card.getByRole("button", { name: "Сохранить описание" }).click();
  await expect(card).toContainText("Описание сохранено");
  await expect(card).toContainText("Работаем без выходных");

  await page.getByRole("link", { name: "История" }).click();
  const entry = page.getByTestId("history-entry").filter({ hasText: "Вы изменили цель" });
  await expect(entry).toHaveCount(1);
  await expect(entry.getByRole("button", { name: "Вернуть как было" })).toBeVisible();
  const cardEntry = page.getByTestId("history-entry").filter({ hasText: "Вы изменили описание бизнеса" });
  await expect(cardEntry).toContainText("Преимущества");
  await expect(cardEntry.getByRole("button", { name: "Вернуть как было" })).toBeVisible();
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
