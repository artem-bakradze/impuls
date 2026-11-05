import { expect, test } from "@playwright/test";

test("the start page is one card with «Демо-режим», Google unavailable, and the demo's terms", async ({ page }, testInfo) => {
  await page.goto("/");
  // One card (product-demo spec «Условия демосервиса»): the terms, «Демо-режим» first, Google second.
  const card = page.getByTestId("login-card");
  await expect(card.getByText("Демосервис без оплаты · деньги не списываются")).toBeVisible();
  await expect(card.getByRole("button")).toHaveText(["Демо-режим", "Войти через Google"]);
  await expect(page.getByRole("link", { name: "Посмотреть на примере" })).toHaveCount(0);
  await expect(page.getByText(/Попробовать на своём бизнесе/)).toHaveCount(0);

  // Google is unavailable for now and says why on hover (auth spec «Вход через Google пока недоступен»).
  const google = card.getByRole("button", { name: "Войти через Google" });
  await expect(google).toHaveAttribute("aria-disabled", "true");
  await google.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Вход через Google пока недоступен — попробуйте демо-режим");
  // Playwright waits for an aria-disabled button to become enabled; a forced press checks that it starts nothing.
  await google.click({ force: true });
  await expect(page).toHaveURL((url) => url.pathname === "/");

  for (const width of [320, 360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  // On a 360 px phone both buttons take the card's full width (inside its 18 px padding and 1 px border).
  await page.setViewportSize({ width: 360, height: 740 });
  const cardBox = await card.boundingBox();
  for (const button of await card.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(cardBox !== null && box !== null && Math.abs(box.width - (cardBox.width - 2 * 18 - 2)) <= 4).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("start-phone.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("start-desktop.png"), fullPage: true });

  // The old example's address leads home, and private APIs need a session.
  await page.goto("/demo");
  await page.waitForURL((url) => url.pathname === "/");
  expect((await page.request.get("/api/simulation")).status()).toBe(401);
});

test("a direct request to the Google login opens no Google page and creates no account", async ({ page }) => {
  await page.goto("/api/auth/signin/google");
  await expect(page).toHaveURL((url) => url.host.startsWith("localhost") && url.pathname === "/");
  await expect(page.getByRole("button", { name: "Демо-режим" })).toBeVisible();
  expect((await page.request.get("/api/simulation")).status()).toBe(401);
});
