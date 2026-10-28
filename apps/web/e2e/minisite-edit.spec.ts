import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { e2eMiniSiteDir } from "./env";
import { launchNewBusiness } from "./helpers";

const page_ = (slug: string) => join(e2eMiniSiteDir(), slug, "index.html");
const normalize = (html: string) => html.replace(/[  ]/g, " ");

/** Waits up to a minute for the published file to contain the text (mini-site spec: publish ≤ 1 minute). */
const expectPublished = async (slug: string, text: string): Promise<void> => {
  await expect
    .poll(async () => normalize(await readFile(page_(slug), "utf8").catch(() => "")), { timeout: 60_000 })
    .toContain(text);
};

test("owner publishes a mini-site and edits a price; the change is published and ads with the old price are flagged", async ({ page }) => {
  await launchNewBusiness(page, "minisite");
  const slug = `nogotok-${Date.now()}`;

  await page.getByRole("link", { name: "Настройки" }).click();
  const form = page.getByTestId("minisite-form");
  await form.getByLabel("Адрес мини-сайта").fill(slug);
  await form.getByLabel("Телефон на сайте").fill("+7 900 123-45-67");
  await form.getByLabel("Часы работы на сайте").fill("Пн–Вс 10:00–20:00");
  await form.getByLabel("Номер счётчика Метрики").fill("12345678");
  await form.getByLabel("Рекламодатель").fill("ИП Иванова А. А.");
  await form.getByLabel("ИНН рекламодателя").fill("771234567890");
  await form.getByRole("button", { name: "Опубликовать мини-сайт" }).click();
  await expect(form).toContainText("Мини-сайт опубликован");
  await expectPublished(slug, "1 800 ₽");

  await form.getByLabel("Цена на сайте 1").fill("2000");
  await form.getByRole("button", { name: "Сохранить мини-сайт" }).click();
  await expect(form).toContainText("Мини-сайт опубликован");
  await expectPublished(slug, "2 000 ₽");

  await page.getByRole("link", { name: "История" }).click();
  await expect(page.getByTestId("history-entry").filter({ hasText: "Вы изменили мини-сайт" })).toHaveCount(1);

  await page.getByRole("link", { name: "Сводка" }).click();
  await expect(page.getByText(/теперь 2 000 ₽, а в объявлениях: .+ — ещё 1 800 ₽\. Обновить объявления\?/)).toBeVisible();
});
