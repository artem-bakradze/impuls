import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT, e2eWebEnv } from "./e2e/env";

/**
 * e2e against the local stack: production build of web (started here) + worker on the simulator
 * (started in global setup) + PostgreSQL from compose.yaml. See docs/development.md («E2E»).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    trace: "retain-on-failure",
    ...devices["Pixel 7"],
  },
  webServer: {
    command: `pnpm exec next start --port ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}/`,
    env: e2eWebEnv(),
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
