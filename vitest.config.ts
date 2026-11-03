import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "**/*.contract.test.ts"],
        },
      },
      {
        test: {
          name: "bdd",
          include: ["tests/bdd/steps/**/*.steps.ts"],
          // A scenario may live a whole 30-day simulation week by week; five seconds is tight for the A/B run.
          testTimeout: 20_000,
        },
      },
      {
        test: {
          name: "integration",
          include: ["**/src/**/*.integration.test.ts"],
          exclude: ["**/node_modules/**"],
          // The files share one PostgreSQL database: the simulation ticker of one file must not see another's rows.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "contract",
          include: ["**/src/**/*.contract.test.ts"],
          exclude: ["**/node_modules/**"],
        },
      },
    ],
  },
});
