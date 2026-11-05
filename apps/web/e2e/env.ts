import { tmpdir } from "node:os";
import { join } from "node:path";

export const E2E_PORT = 3100;

/** The e2e stack needs a real PostgreSQL server; there is no default (No-Fallbacks policy). */
export const baseDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is required for e2e, e.g. postgres://impuls:impuls@localhost:54329/impuls");
  }
  return url;
};

/**
 * e2e runs in its own database `<name>_e2e`, recreated by global setup: the simulator keeps campaigns in the
 * worker's memory, so rows from earlier runs (or another local worker on the dev queue) would not match it.
 */
export const e2eDatabaseUrl = (): string => {
  const url = new URL(baseDatabaseUrl());
  url.pathname = `${url.pathname.replace(/^\//, "")}_e2e`;
  return url.toString();
};

export const e2eDatabaseName = (): string => new URL(e2eDatabaseUrl()).pathname.replace(/^\//, "");

/**
 * Environment of the web server under test. e2e signs in through «Демо-режим» or the test-only email login
 * (AUTH_TEST_LOGIN=enabled), which exists only in this mode; Google is off for now.
 */
export const e2eWebEnv = (): Record<string, string> => ({
  DATABASE_URL: e2eDatabaseUrl(),
  AUTH_SECRET: "e2e-only-secret-not-for-real-deployments-0123456789",
  AUTH_URL: `http://localhost:${E2E_PORT}`,
  AUTH_TRUST_HOST: "true",
  AUTH_TEST_LOGIN: "enabled",
  DIRECT_API_MODE: "simulator",
  SUPPORT_EMAIL: "support@impuls.test",
});

/** Published mini-sites of the e2e worker (a temp directory, recreated per run by global setup). */
export const e2eMiniSiteDir = (): string => join(tmpdir(), "impuls-e2e-minisites");

/**
 * Worker on the simulator with the deterministic test agent (decisions and insights without model calls); emails go
 * to the local Mailpit inbox from docs/development.md.
 */
export const e2eWorkerEnv = (): Record<string, string> => ({
  DATABASE_URL: e2eDatabaseUrl(),
  DIRECT_API_MODE: "simulator",
  AGENT_RUNTIME: "heuristic",
  CREATIVES: "template",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "Импульс e2e <noreply@impuls.test>",
  APP_URL: `http://localhost:${E2E_PORT}`,
  TEAM_ALERT_EMAIL: "team@impuls.test",
  MINISITE_DIR: e2eMiniSiteDir(),
});
