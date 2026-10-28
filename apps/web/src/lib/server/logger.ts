import "server-only";
import { createLogger } from "@impuls/worker";

/** Structured English logs with secrets and personal data masked (shared with the worker). */
export const logger = createLogger();
