import { CreativesError, htmlToText, LlmError } from "@impuls/agent";
import type { CardDraft, CardFacts, Creatives, SourcePage } from "@impuls/agent";
import type { Command, LocalDate } from "@impuls/core";
import { decideApproval, enqueueAgentEvent } from "./agent-turn";
import { confirmClients } from "./analytics";
import { changeBudget } from "./budget-settings";
import type { JobContext } from "./context";
import { rollback } from "./history";
import { deleteAccount } from "./account";
import { launchAds } from "./launch";
import type { LaunchPlan } from "./launch";
import { fetchPublicPage } from "./pages";

/** Jobs that `web` enqueues; only the worker executes them (design decision 3). */
export type WebJob =
  | { kind: "command"; businessId: string; command: Command; explanation: string }
  | { kind: "rollback"; businessId: string; entryId: string; includeLater?: boolean; confirmDifference?: boolean }
  | { kind: "budget"; businessId: string; monthlyBudgetRub: number; confirmed: boolean }
  | { kind: "approval"; businessId: string; approvalId: string; approve: boolean }
  | { kind: "clients"; businessId: string; week: LocalDate; clients: number }
  | { kind: "launch"; businessId: string; plan: LaunchPlan }
  | { kind: "delete_account"; businessId: string }
  /** Creates the mini-site on first save, then updates it through the executor (history, rollback). */
  | { kind: "minisite_save"; businessId: string; slug: string; card: string; metrikaCounterId: number; advertiser: { name: string; inn: string } }
  /** «Где вас найти?» → «Вот как мы вас поняли»: reads the pages and extracts the card (business-onboarding spec). */
  | { kind: "extract_card"; businessId: string; sources: { siteUrl: string; mapsUrl: string; vkUrl: string; about: string } }
  /** Ad texts, phrases and negative phrases for the preview step (ad-creatives spec). */
  | { kind: "generate_creatives"; businessId: string; facts: CardFacts; channels: { search: boolean; network: boolean } };

/** Job errors whose Russian message the wizard shows as is. */
export class CreativeJobError extends Error {
  constructor(
    readonly code: "CARD_UNREADABLE" | "CREATIVES_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "CreativeJobError";
  }
}

export interface ExtractCardResult {
  card: CardDraft;
  /** Sources that could not be read; the wizard says so and the owner fills the card. */
  unreadable: ("site" | "maps" | "vk")[];
}

const CARD_UNREADABLE = "Не получилось прочитать страницу — расскажите о бизнесе своими словами";

const extractCard = async (ctx: JobContext, sources: Extract<WebJob, { kind: "extract_card" }>["sources"]): Promise<ExtractCardResult> => {
  if (!ctx.creatives.readsPages) {
    return { card: await ctx.creatives.extractCard([]), unreadable: [] };
  }
  const pages: SourcePage[] = [];
  const unreadable: ExtractCardResult["unreadable"] = [];
  for (const [source, url] of [["site", sources.siteUrl], ["maps", sources.mapsUrl], ["vk", sources.vkUrl]] as const) {
    if (url.trim() === "") continue;
    try {
      const text = htmlToText(await fetchPublicPage(url));
      if (text.length < 40) throw new Error("page has almost no text");
      pages.push({ source, text });
    } catch {
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
      throw new CreativeJobError("CARD_UNREADABLE", CARD_UNREADABLE);
    }
    throw error;
  }
};

const generateCreatives = async (ctx: JobContext, job: Extract<WebJob, { kind: "generate_creatives" }>): Promise<Creatives> => {
  try {
    return await ctx.creatives.generate(job.facts, job.channels);
  } catch (error) {
    if (error instanceof LlmError || error instanceof CreativesError) {
      throw new CreativeJobError("CREATIVES_FAILED", "Не получилось подготовить объявления. Попробуйте ещё раз через минуту");
    }
    throw error;
  }
};

export const WEB_JOB_QUEUE = "web-job";

const SETTINGS_COMMANDS = new Set<Command["type"]>(["UpdateSchedule", "UpdateGeo", "UpdateMiniSite", "PauseAll", "ResumeAll"]);

/** Executes a web job and returns a JSON-serializable result for the UI. */
export const handleWebJob = async (ctx: JobContext, job: WebJob): Promise<unknown> => {
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
    case "approval":
      return decideApproval(ctx, job.businessId, job.approvalId, job.approve);
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
      return extractCard(ctx, job.sources);
    case "generate_creatives":
      return generateCreatives(ctx, job);
  }
};
