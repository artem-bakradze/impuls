import { expect, test } from "@playwright/test";
import { choose, launchNewBusiness } from "./helpers";

test("changing show hours goes to every campaign and can be rolled back from the journal", async ({ page }) => {
  await launchNewBusiness(page, "hours");

  await page.getByRole("link", { name: "Настройки" }).click();
  // The site in one line, no mini-site form (the mini-site is out of the MVP).
  await expect(page.getByTestId("site-change")).toContainText("Объявления ведут на nogotok.example");
  await expect(page.getByRole("link", { name: "nogotok.example" })).toBeVisible();
  await expect(page.getByTestId("minisite-form")).toHaveCount(0);
  const schedule = page.locator("#where");
  // The current value is read before the editor opens.
  await expect(schedule).toContainText("Пн–Вс 10:00–20:00");
  await page.getByRole("button", { name: "Изменить: Когда показываем" }).click();
  await choose(page, "Показывать до", "до 21:00");
  await page.getByRole("button", { name: "Сохранить время" }).click();
  await expect(schedule).toContainText("Расписание обновлено во всей рекламе");
  await expect(schedule).toContainText("Пн–Вс 10:00–21:00");

  // The history is a sheet of «Реклама»: the owner's change in their words, with «Вернуть как было».
  await page.getByRole("link", { name: "Реклама" }).click();
  await page.getByRole("button", { name: /История/ }).click();
  const journal = page.getByTestId("agent-journal");
  const changes = journal.getByTestId("journal-change").filter({ hasText: "время показа: было Пн–Вс 10:00–20:00 → стало Пн–Вс 10:00–21:00" });
  await expect(changes).toHaveCount(2);

  const first = changes.first();
  await first.getByRole("button", { name: "Вернуть как было" }).click();
  const dialog = page.locator(".ant-modal");
  await expect(dialog.getByTestId("rollback-consequences")).toContainText("Вернётся прежнее расписание показов");
  await dialog.getByRole("button", { name: "Вернуть как было" }).click();
  await expect(dialog).toContainText("Готово — вернули как было");
  await dialog.getByRole("button", { name: "Понятно" }).click();

  await expect(journal.getByTestId("journal-change").filter({ hasText: "время показа: было Пн–Вс 10:00–21:00 → стало Пн–Вс 10:00–20:00" })).toHaveCount(1);
  await expect(journal.getByTestId("journal-change").filter({ hasText: "отменено" })).toHaveCount(1);
});

test("the owner sets an own cost per lead, edits the business card and sees how to delete the account", async ({ page }) => {
  await launchNewBusiness(page, "goal");
  await page.getByRole("link", { name: "Настройки" }).click();
  await expect(page.getByText("Спрашивать перед крупными изменениями")).toHaveCount(0);
  const goal = page.locator("#budget");
  await expect(goal).toContainText("Подбираем сами по результатам");
  await page.getByRole("button", { name: "Изменить: Цена обращения" }).click();
  await goal.getByRole("radio", { name: "Укажу сумму" }).click();
  await page.getByLabel("Цена одного обращения").fill("500");
  await goal.getByRole("button", { name: "Сохранить цель" }).click();
  await expect(goal).toContainText("Цель сохранена");
  await expect(goal).toContainText("До 500 ₽");
  await expect(page.getByTestId("site-change")).toContainText("удалить аккаунт — напишите на support@impuls.test");

  // «Что рекламируем» is editable; the running ads stay as they are.
  const card = page.getByTestId("card-section");
  await card.getByRole("button", { name: "Изменить описание" }).click();
  await card.getByLabel("Преимущество 1").fill("Работаем без выходных");
  await card.getByRole("button", { name: "Сохранить описание" }).click();
  await expect(card).toContainText("Описание сохранено");
  await expect(card).toContainText("Работаем без выходных");

  await page.getByRole("link", { name: "Реклама" }).click();
  await page.getByRole("button", { name: /История/ }).click();
  const journal = page.getByTestId("agent-journal");
  const entry = journal.getByTestId("journal-change").filter({ hasText: "Вы: Цель по цене обращения" });
  await expect(entry).toHaveCount(1);
  await expect(entry.getByRole("button", { name: "Вернуть как было" })).toBeVisible();
  const cardEntry = journal.getByTestId("journal-change").filter({ hasText: "Вы: Описание бизнеса" });
  await expect(cardEntry).toContainText("преимущества");
  await expect(cardEntry.getByRole("button", { name: "Вернуть как было" })).toBeVisible();
});

test("pause and resume all ads from the settings", async ({ page }) => {
  await launchNewBusiness(page, "pause");
  await page.getByRole("link", { name: "Настройки" }).click();
  await page.getByRole("button", { name: "Поставить рекламу на паузу" }).click();
  await expect(page.getByText("Реклама на паузе", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Реклама" }).click();
  await expect(page.getByText("Реклама на паузе", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Возобновить" }).click();
  await expect(page.getByText("Реклама на паузе", { exact: true })).toHaveCount(0);
});
