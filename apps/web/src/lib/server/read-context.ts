import "server-only";
import { SIMULATOR_CAPABILITIES, YANDEX_DIRECT_CAPABILITIES } from "@impuls/platforms";
import type { PlatformCapabilities } from "@impuls/platforms";
import { ManualClock, systemClock } from "@impuls/worker";
import type { BusinessMode, Clock, JobContext } from "@impuls/worker";
import { webConfig } from "./config";
import { store } from "./runtime";

/**
 * Strategy catalog and minimum limit of the platform a business works with; static data, no platform calls. A
 * simulated business uses Direct's, like its market (add-simulation-mode decision 2).
 */
export const platformCapabilities = (mode: BusinessMode = "direct"): PlatformCapabilities =>
  mode === "direct" && webConfig().DIRECT_API_MODE === "simulator" ? SIMULATOR_CAPABILITIES : YANDEX_DIRECT_CAPABILITIES;

/** «Now» of a business: real time, or the virtual time of its simulation, so every screen reads its own day. */
export const businessClock = async (businessId: string): Promise<Clock> => {
  const simulation = await store().getSimulation(businessId);
  return simulation === null ? systemClock : new ManualClock(simulation.simNow);
};

const forbidden = (what: string) => (): never => {
  throw new Error(`web must not ${what}: enqueue a web job instead (design decision 3)`);
};

/**
 * Context for worker read helpers (`weeklyClientCost` and the like) that only read the store.
 * Everything with side effects throws, so a read helper that starts writing fails loudly.
 */
export const readOnlyContext = (clock: Clock = systemClock): JobContext => ({
  store: store(),
  clock,
  locks: { withLock: forbidden("take business locks"), tryWithLock: forbidden("take business locks") },
  executor: new Proxy({}, { get: forbidden("execute commands") }) as JobContext["executor"],
  platformFor: forbidden("call the ad platform"),
  agent: { name: "web-read-only", instructionsVersion: "none", decides: false, runTurn: forbidden("run agent turns") },
  creatives: { readsPages: false, extractCard: forbidden("call the LLM"), generate: forbidden("call the LLM"), variant: forbidden("call the LLM") },
  images: { paid: false, draw: forbidden("draw ad pictures") },
});
