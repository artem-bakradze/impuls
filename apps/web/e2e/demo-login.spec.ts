import { expect, test } from "@playwright/test";
import { expectStep, loginAsDemo } from "./helpers";

/**
 * «Демо-режим» (auth spec «Демо-вход»): no form, a new account per browser, the same browser comes back to its demo,
 * another browser gets its own empty one.
 */
test("a demo lives in its browser: it comes back there, and another browser gets a new one", async ({ page, browser }) => {
  await loginAsDemo(page);
  await expectStep(page, 1, "Где вас найти?");
  await page.getByLabel("Ваш сайт").fill("nogotok.example");
  await page.getByRole("button", { name: "Дальше" }).click();
  await expectStep(page, 2, "Вот как мы вас поняли");

  // The same browser: the start page sends the demo back to its step.
  await page.goto("/");
  await page.waitForURL("**/wizard");
  await expectStep(page, 2, "Вот как мы вас поняли");

  // Another browser: a new empty demo; the first one is untouched.
  const other = await browser.newContext();
  const second = await other.newPage();
  await loginAsDemo(second);
  await expectStep(second, 1, "Где вас найти?");
  await expect(second.getByLabel("Ваш сайт")).toHaveValue("");
  await other.close();
  await page.reload();
  await expectStep(page, 2, "Вот как мы вас поняли");
});
