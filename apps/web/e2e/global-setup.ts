import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { createPool } from "@impuls/db";
import { baseDatabaseUrl, e2eDatabaseName, e2eDatabaseUrl, e2eWorkerEnv } from "./env";

const REPO_ROOT = path.join(import.meta.dirname, "../../..");
const START_TIMEOUT_MS = 60_000;

/** Drops and recreates the e2e database, then applies the Drizzle migrations to it. */
const recreateDatabase = async (): Promise<void> => {
  const name = e2eDatabaseName();
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`Unexpected e2e database name ${name}`);
  }
  const admin = createPool(baseDatabaseUrl());
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const migrate = spawnSync("pnpm", ["db:migrate"], { cwd: REPO_ROOT, env: { ...process.env, DATABASE_URL: e2eDatabaseUrl() }, encoding: "utf8" });
  if (migrate.status !== 0) {
    throw new Error(`Migrations failed:\n${migrate.stdout}\n${migrate.stderr}`);
  }
};

/**
 * Prepares a clean database and starts the worker on the simulator for the whole run. The simulator keeps
 * its state in memory, so the campaigns created by these tests exist only while this worker runs.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  await recreateDatabase();
  const worker = spawn("pnpm", ["--filter", "@impuls/worker", "start"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...e2eWorkerEnv() },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Worker did not start in ${START_TIMEOUT_MS} ms:\n${output}`)), START_TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Worker started")) {
        clearTimeout(timer);
        resolve();
      }
    };
    worker.stdout.on("data", onData);
    worker.stderr.on("data", onData);
    worker.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Worker exited with code ${String(code)}:\n${output}`));
    });
  });
  return () => {
    if (worker.pid !== undefined) {
      process.kill(-worker.pid, "SIGTERM");
    }
    return Promise.resolve();
  };
}
