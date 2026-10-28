/**
 * Lighthouse check of a published mini-site (mini-site spec: fast on mobile; task 6.5: mobile ≥ 90).
 * Run: pnpm --filter @impuls/web lighthouse:minisite
 */
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { chromium } from "@playwright/test";
import { startStaticMiniSite } from "./minisite-fixture";

const THRESHOLD = 0.9;

const main = async (): Promise<void> => {
  const site = await startStaticMiniSite(3202);
  const chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: ["--headless=new", "--no-sandbox"] });
  try {
    const result = await lighthouse(site.url, { port: chrome.port, output: "json", logLevel: "error", formFactor: "mobile", onlyCategories: ["performance", "accessibility", "best-practices", "seo"] });
    if (!result) {
      throw new Error("Lighthouse returned no result");
    }
    const scores = Object.fromEntries(Object.entries(result.lhr.categories).map(([key, category]) => [key, category.score ?? 0]));
    process.stdout.write(`${JSON.stringify(scores)}\n`);
    const weak = Object.values(result.lhr.audits).filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== "informative" && a.scoreDisplayMode !== "notApplicable");
    for (const audit of weak) {
      process.stdout.write(`  - ${audit.id}: ${audit.score} ${audit.displayValue ?? ""}\n`);
    }
    const failed = Object.entries(scores).filter(([, score]) => score < THRESHOLD);
    if (failed.length > 0) {
      throw new Error(`Below ${THRESHOLD}: ${failed.map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
  } finally {
    chrome.kill();
    site.server.close();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
