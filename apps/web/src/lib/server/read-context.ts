import "server-only";
import { SIMULATOR_CAPABILITIES, YANDEX_DIRECT_CAPABILITIES } from "@impuls/platforms";
import type { PlatformCapabilities } from "@impuls/platforms";
import { systemClock } from "@impuls/worker";
import type { JobContext } from "@impuls/worker";
import { webConfig } from "./config";
import { store } from "./runtime";

/** Strategy catalog and minimum limit of the configured platform; static data, no platform calls. */
export const platformCapabilities = (): PlatformCapabilities =>
  webConfig().DIRECT_API_MODE === "simulator" ? SIMULATOR_CAPABILITIES : YANDEX_DIRECT_CAPABILITIES;

const forbidden = (what: string) => (): never => {
  throw new Error(`web must not ${what}: enqueue a web job instead (design decision 3)`);
};

/**
 * Context for worker read helpers (`weeklyClientCost` and the like) that only read the store.
 * Everything with side effects throws, so a read helper that starts writing fails loudly.
 */
export const readOnlyContext = (): JobContext => ({
  store: store(),
  clock: systemClock,
  locks: { withLock: forbidden("take business locks"), tryWithLock: forbidden("take business locks") },
  executor: new Proxy({}, { get: forbidden("execute commands") }) as JobContext["executor"],
  platformFor: forbidden("call the ad platform"),
  agent: { name: "web-read-only", instructionsVersion: "none", runTurn: forbidden("run agent turns") },
});
