import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.join(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  /** Workspace packages ship TypeScript sources. */
  transpilePackages: ["@impuls/worker", "@impuls/core", "@impuls/db", "@impuls/platforms", "@impuls/agent", "@impuls/minisite"],
  serverExternalPackages: ["pg", "pg-boss", "nodemailer"],
  poweredByHeader: false,
};

export default nextConfig;
