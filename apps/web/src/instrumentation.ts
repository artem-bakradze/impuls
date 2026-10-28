/** Fail fast (No-Fallbacks policy): a server with missing or invalid configuration does not start. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkConfigOrExit } = await import("./instrumentation-node");
    checkConfigOrExit();
  }
}
