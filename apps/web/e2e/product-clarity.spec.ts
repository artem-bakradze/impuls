import { expect, test } from "@playwright/test";

test("the landing page states the demo's terms with one action and protects private APIs", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByText(/Импульс — демосервис без оплаты/)).toBeVisible();
  // One way to try it: the simulation of one's own business (product-demo spec «Условия демосервиса»).
  await expect(page.getByRole("button", { name: /Попробовать на своём бизнесе/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Посмотреть на примере" })).toHaveCount(0);
  for (const width of [320, 360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  await page.screenshot({ path: testInfo.outputPath("landing.png"), fullPage: true });
  // The old example's address leads home.
  await page.goto("/demo");
  await page.waitForURL((url) => url.pathname === "/");
  expect((await page.request.get("/api/simulation")).status()).toBe(401);
});
