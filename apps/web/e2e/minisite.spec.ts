import { expect, test } from "@playwright/test";
import type { Server } from "node:http";
import { startStaticMiniSite } from "./minisite-fixture";

let site: { url: string; server: Server };

test.beforeAll(async () => {
  site = await startStaticMiniSite(3201);
});

test.afterAll(async () => {
  await new Promise((resolve) => site.server.close(resolve));
});

test("the mini-site opens as static files and «Позвонить» reaches the Metrika goal", async ({ page }) => {
  // Block the real Metrika tag and record reachGoal calls instead.
  await page.route("https://mc.yandex.ru/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await page.addInitScript(() => {
    const calls: unknown[][] = [];
    (window as unknown as { __ymCalls: unknown[][] }).__ymCalls = calls;
    Object.defineProperty(window, "ym", {
      configurable: true,
      get: () => (...args: unknown[]) => calls.push(args),
      set: () => undefined,
    });
  });
  await page.goto(site.url);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Салон «Ноготки»");
  await expect(page.getByText("Рекламодатель: ИП Иванова А. А., ИНН 771234567890")).toBeVisible();

  const call = page.getByRole("link", { name: /Позвонить/ });
  await expect(call).toHaveAttribute("href", "tel:+79001234567");
  await call.evaluate((link) => link.addEventListener("click", (event) => event.preventDefault(), { once: true }));
  await call.click();
  const calls = await page.evaluate(() => (window as unknown as { __ymCalls: unknown[][] }).__ymCalls);
  expect(calls).toContainEqual([12345678, "reachGoal", "call"]);
});

test("the map widget loads only when the visitor asks for it", async ({ page }) => {
  await page.route("https://yandex.ru/map-widget/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>map</p>" }));
  await page.route("https://mc.yandex.ru/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await page.goto(site.url);
  await expect(page.locator("iframe.map")).toHaveCount(0);
  await page.getByRole("button", { name: "Показать карту" }).click();
  await expect(page.locator("iframe.map")).toHaveAttribute("title", "Карта: Москва, Профсоюзная улица, 1");
});
