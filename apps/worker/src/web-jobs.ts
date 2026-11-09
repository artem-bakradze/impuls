import { CreativesError, htmlToText, LlmError } from "@impuls/agent";
import type { CardDraft, CardFacts, Creatives, SourcePage } from "@impuls/agent";
import type { Command, LocalDate } from "@impuls/core";
import { drawWizardImages } from "./ad-images";
import type { DrawnImages } from "./ad-images";
import { enqueueAgentEvent } from "./agent-turn";
import { confirmClients } from "./analytics";
import { changeBudget } from "./budget-settings";
import type { JobContext } from "./context";
import { rollback } from "./history";
import { deleteAccount } from "./account";
import { launchAds } from "./launch";
import type { LaunchPlan } from "./launch";
import { createLogger } from "./logger";
import { fetchPublicPage, findMetrikaCounter, PageFetchError } from "./pages";
import { controlSimulation, launchSimulation, SimulationError, withSimulation } from "./simulation-mode";
import type { SimulationControl } from "./simulation-mode";
import { ADS_CHANGED_MESSAGE } from "./simulation-period";

/** Jobs that `web` enqueues; only the worker executes them (design decision 3). */
export type WebJob =
  | { kind: "command"; businessId: string; command: Command; explanation: string }
  | { kind: "rollback"; businessId: string; entryId: string; includeLater?: boolean; confirmDifference?: boolean }
  | { kind: "budget"; businessId: string; monthlyBudgetRub: number; confirmed: boolean }
  | { kind: "clients"; businessId: string; week: LocalDate; clients: number }
  /** `simulation`: «Запустить в симуляции» on the training market instead of Direct (simulation-mode spec). */
  | { kind: "launch"; businessId: string; plan: LaunchPlan; simulation?: true }
  /** The simulation player: a period of the owner's stats, «Продолжить расчёт», «Начать заново», «Запустить по-настоящему». */
  | { kind: "simulation_control"; businessId: string; control: SimulationControl }
  | { kind: "delete_account"; businessId: string }
  /** Creates the mini-site on first save, then updates it through the executor (history, rollback). */
  | { kind: "minisite_save"; businessId: string; slug: string; card: string; metrikaCounterId: number; advertiser: { name: string; inn: string } }
  /** «Где вас найти?» → «Вот как мы вас поняли»: reads the pages and extracts the card (business-onboarding spec). */
  | { kind: "extract_card"; businessId: string; sources: { siteUrl: string; mapsUrl: string; vkUrl: string; about: string } }
  /** «Что для вас клиент?»: is the Metrica counter code on the owner's site (analytics spec)? */
  | { kind: "check_counter"; businessId: string; siteUrl: string }
  /** Ad texts, phrases and negative phrases for the preview step (ad-creatives spec). */
  | { kind: "generate_creatives"; businessId: string; facts: CardFacts; channels: { search: boolean; network: boolean } }
  /**
   * Pictures of partner-site ads (network-ad-images decision 3), drawn after the texts so they never hold them up:
   * `previousImageId` null for an ad's first picture, the current one for «Другая картинка» and «Попробовать ещё раз».
   */
  | { kind: "draw_ad_images"; businessId: string; facts: CardFacts; ads: { title: string; previousImageId: string | null }[] };

/** Job errors whose Russian message the wizard shows as is. */
export class CreativeJobError extends Error {
  constructor(
    readonly code: "CARD_UNREADABLE" | "CREATIVES_FAILED" | "SIMULATION_ADS_CHANGED",
    message: string,
    /** The technical reason, kept for the job log; the owner sees only `message`. */
    options?: { cause: unknown },
  ) {
    super(message, options);
    this.name = "CreativeJobError";
  }
}

export interface ExtractCardResult {
  card: CardDraft;
  /** Sources that could not be read; the wizard says so and the owner fills the card. */
  unreadable: ("site" | "maps" | "vk")[];
}

/** Result of the site check; the web shows it in plain words and never blocks the launch on it. */
export type CounterCheck = { status: "found"; counterId: number | null } | { status: "not_found" } | { status: "unreachable" };

/** Reads the site page with the same SSRF limits as card extraction and looks for the Metrica code. */
export const checkCounter = async (siteUrl: string, fetchPage: (url: string) => Promise<string> = fetchPublicPage): Promise<CounterCheck> => {
  let html: string;
  try {
    html = await fetchPage(siteUrl);
  } catch {
    return { status: "unreachable" };
  }
  const counter = findMetrikaCounter(html);
  return counter.found ? { status: "found", counterId: counter.counterId } : { status: "not_found" };
};

/**
 * Downloads an owner's page with the context's host resolution (the system DNS unless DNS over HTTPS is configured).
 * `partial`: the first 2 MB of a heavier page, for the card; the Metrica check reads whole pages only.
 */
const readPage = (ctx: JobContext, options: { partial?: boolean } = {}) => (url: string): Promise<string> =>
  fetchPublicPage(url, fetch, ctx.resolveHost, options);

/** The host of an owner's page for logs: the business's public site, never a path or query. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
};

const CARD_UNREADABLE = "Не получилось прочитать страницу — расскажите о бизнесе своими словами";

const extractCard = async (ctx: JobContext, businessId: string, sources: Extract<WebJob, { kind: "extract_card" }>["sources"]): Promise<ExtractCardResult> => {
  if (!ctx.creatives.readsPages) {
    return { card: await ctx.creatives.extractCard([]), unreadable: [] };
  }
  const pages: SourcePage[] = [];
  const unreadable: ExtractCardResult["unreadable"] = [];
  for (const [source, url] of [["site", sources.siteUrl], ["maps", sources.mapsUrl], ["vk", sources.vkUrl]] as const) {
    if (url.trim() === "") continue;
    try {
      const text = htmlToText(await readPage(ctx, { partial: true })(url));
      if (text.length < 40) throw new Error("page has almost no text");
      pages.push({ source, text });
    } catch (error) {
      // The owner sees one plain message; the reason (an internal address behind a fake-IP VPN, a refused bot, a
      // timeout) is only here.
      createLogger().warn("Card source unreadable", {
        businessId,
        source,
        host: hostOf(url),
        errorCode: error instanceof PageFetchError ? error.code : "PAGE_WITHOUT_TEXT",
        reason: error instanceof Error ? error.message : String(error),
      });
      unreadable.push(source);
    }
  }
  if (sources.about.trim() !== "") {
    pages.push({ source: "about", text: sources.about.trim() });
  }
  if (pages.length === 0) {
    throw new CreativeJobError("CARD_UNREADABLE", CARD_UNREADABLE);
  }
  try {
    return { card: await ctx.creatives.extractCard(pages), unreadable };
  } catch (error) {
    if (error instanceof LlmError) {
      throw new CreativeJobError("CARD_UNREADABLE", CARD_UNREADABLE, { cause: error });
    }
    throw error;
  }
};

const generateCreatives = async (ctx: JobContext, job: Extract<WebJob, { kind: "generate_creatives" }>): Promise<Creatives> => {
  try {
    return await ctx.creatives.generate(job.facts, job.channels);
  } catch (error) {
    if (error instanceof LlmError || error instanceof CreativesError) {
      throw new CreativeJobError("CREATIVES_FAILED", "Не получилось подготовить объявления. Попробуйте ещё раз через минуту", { cause: error });
    }
    throw error;
  }
};

export const WEB_JOB_QUEUE = "web-job";

const SETTINGS_COMMANDS = new Set<Command["type"]>(["UpdateSchedule", "UpdateGeo", "UpdateCard", "UpdateMiniSite", "PauseAll", "ResumeAll"]);

/** Jobs that read pages or call the LLM before launch: the same for both modes. */
const MODE_FREE = new Set<WebJob["kind"]>(["extract_card", "check_counter", "generate_creatives", "draw_ad_images"]);

/**
 * Executes a web job and returns a JSON-serializable result for the UI. A job of a simulated business runs in its
 * world — virtual clock and market (add-simulation-mode decision 2).
 */
export const handleWebJob = async (ctx: JobContext, job: WebJob): Promise<unknown> => {
  try {
    if (job.kind === "simulation_control") {
      return await controlSimulation(ctx, job.businessId, job.control);
    }
    if (job.kind === "launch" && job.simulation) {
      return await launchSimulation(ctx, job.businessId, job.plan);
    }
  } catch (error) {
    // The web checked the window against the same advertising a moment ago: a refusal here means it changed meanwhile.
    if (error instanceof SimulationError && (error.code === "ADS_CHANGED" || error.code === "PERIOD_INVALID")) {
      throw new CreativeJobError("SIMULATION_ADS_CHANGED", ADS_CHANGED_MESSAGE, { cause: error });
    }
    throw error;
  }
  if (!MODE_FREE.has(job.kind) && (await ctx.store.getBusiness(job.businessId)).mode === "simulation") {
    return withSimulation(ctx, job.businessId, (world) => handleJob(world.ctx, job));
  }
  return handleJob(ctx, job);
};

const handleJob = async (ctx: JobContext, job: WebJob): Promise<unknown> => {
  switch (job.kind) {
    case "command": {
      const result = await ctx.executor.execute({ businessId: job.businessId, command: job.command, actor: "user", reasonCode: "USER_CHANGE", explanation: job.explanation });
      if ((result.status === "applied" || result.status === "clamped") && SETTINGS_COMMANDS.has(job.command.type)) {
        await enqueueAgentEvent(ctx, job.businessId, { kind: "settings_changed" });
      }
      return result;
    }
    case "rollback":
      return rollback(ctx, {
        businessId: job.businessId,
        entryId: job.entryId,
        ...(job.includeLater !== undefined ? { includeLater: job.includeLater } : {}),
        ...(job.confirmDifference !== undefined ? { confirmDifference: job.confirmDifference } : {}),
      });
    case "budget": {
      const result = await changeBudget(ctx, job.businessId, job.monthlyBudgetRub, job.confirmed);
      if (result.applied) {
        await enqueueAgentEvent(ctx, job.businessId, { kind: "settings_changed" });
      }
      return result;
    }
    case "clients":
      await confirmClients(ctx, job.businessId, job.week, job.clients);
      return { ok: true };
    case "launch":
      return launchAds(ctx, job.businessId, job.plan);
    case "delete_account":
      return deleteAccount(ctx, job.businessId);
    case "minisite_save": {
      const business = await ctx.store.getBusiness(job.businessId);
      const settings = { slug: job.slug, metrikaCounterId: job.metrikaCounterId, advertiser: job.advertiser };
      if (business.miniSite === null) {
        await ctx.store.saveBusiness({ ...business, miniSite: { ...settings, card: job.card } });
        return ctx.executor.execute({ businessId: job.businessId, command: { type: "PublishMiniSite" }, actor: "user", reasonCode: "USER_MINISITE", explanation: "Вы опубликовали мини-сайт." });
      }
      await ctx.store.saveBusiness({ ...business, miniSite: { ...business.miniSite, ...settings } });
      return ctx.executor.execute({ businessId: job.businessId, command: { type: "UpdateMiniSite", card: job.card }, actor: "user", reasonCode: "USER_MINISITE", explanation: "Вы изменили мини-сайт." });
    }
    case "extract_card":
      return extractCard(ctx, job.businessId, job.sources);
    case "check_counter": {
      const result = await checkCounter(job.siteUrl, readPage(ctx));
      await ctx.locks.withLock(job.businessId, async () => {
        const business = await ctx.store.getBusiness(job.businessId);
        if (business.card.siteUrl !== job.siteUrl) return;
        await ctx.store.saveBusiness({ ...business, card: { ...business.card, measurement: { siteUrl: job.siteUrl, status: result.status, counterId: result.status === "found" ? result.counterId : null } } });
      });
      return result;
    }
    case "generate_creatives":
      return generateCreatives(ctx, job);
    case "draw_ad_images": {
      // An object, not a bare list: pg-boss would keep a list as `{ value }`.
      const drawn: DrawnImages = { images: await drawWizardImages(ctx, job.businessId, job.facts, job.ads) };
      return drawn;
    }
    case "simulation_control":
      throw new Error("simulation_control is routed before the mode switch");
  }
};
