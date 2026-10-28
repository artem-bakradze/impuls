import { parseWebConfig, WebConfigError } from "./lib/config-check";

/** Node-only part of instrumentation: validates the environment and stops the process on errors. */
export const checkConfigOrExit = (): void => {
  try {
    parseWebConfig(process.env);
  } catch (error) {
    if (error instanceof WebConfigError) {
      process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: "error", message: "Web failed to start", problems: error.problems })}\n`);
      process.exit(1);
    }
    throw error;
  }
};
