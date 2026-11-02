import type { Command } from "@impuls/core";
import { z } from "zod";
import { formatRub } from "@/lib/format";
import { AD_TEXT_MAX, AD_TITLE_MAX, interimAutoGoalRub } from "@/lib/onboarding";
import { handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { parseBody } from "@/lib/server/request";
import { store } from "@/lib/server/runtime";
import { apiLaunchedBusiness } from "@/lib/server/session";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pauseAll") }),
  z.object({ action: z.literal("resumeAll") }),
  z.object({ action: z.literal("schedule"), schedule: z.string().regex(/^(Пн–Вс|Пн–Пт|Пн–Сб|Вт–Вс) \d{2}:00–\d{2}:00$/).refine((s) => s.slice(-11, -6) !== s.slice(-5)) }),
  z.object({ action: z.literal("city"), city: z.string().trim().min(1).max(100) }),
  z.object({ action: z.literal("goal"), goal: z.discriminatedUnion("mode", [z.object({ mode: z.literal("user"), rub: z.number().int().min(1).max(1_000_000) }), z.object({ mode: z.literal("auto") })]) }),
  z.object({ action: z.literal("adText"), adId: z.string().min(1), title: z.string().trim().min(1).max(AD_TITLE_MAX), text: z.string().trim().min(1).max(AD_TEXT_MAX) }),
  z.object({ action: z.literal("adStatus"), adId: z.string().min(1), active: z.boolean() }),
  z.object({
    action: z.literal("card"),
    card: z.object({
      category: z.string().trim().max(100),
      services: z.array(z.object({ name: z.string().trim().min(1).max(100), priceRub: z.number().int().positive().max(10_000_000).nullable() })).min(1).max(20),
      advantages: z.array(z.string().trim().min(1).max(100)).max(3),
    }),
  }),
]);

const servicesText = (services: { name: string; priceRub: number | null }[]): string =>
  services.map((s) => (s.priceRub === null ? s.name : `${s.name} — ${formatRub(s.priceRub * 100)}`)).join("; ");

/**
 * Owner's settings changes become commands for the worker's executor (design decision 3): lock, before-check,
 * guards, history, platform. Object ids are checked by the executor against the session's business.
 */
export async function POST(request: Request) {
  return handleApi("commands.enqueue", async () => {
    const business = await apiLaunchedBusiness();
    const body = await parseBody(request, Body);
    const directions = await store().directions(business.id);
    const jobs: { command: Command; explanation: string }[] = [];
    switch (body.action) {
      case "pauseAll":
        jobs.push({ command: { type: "PauseAll" }, explanation: "Вы поставили всю рекламу на паузу." });
        break;
      case "resumeAll":
        jobs.push({ command: { type: "ResumeAll" }, explanation: "Вы возобновили рекламу." });
        break;
      case "schedule":
        for (const d of directions) {
          jobs.push({
            command: { type: "UpdateSchedule", directionId: d.id, schedule: body.schedule },
            explanation: `Вы изменили время показа: было «${d.schedule}», стало «${body.schedule}».`,
          });
        }
        break;
      case "city":
        for (const d of directions) {
          jobs.push({
            command: { type: "UpdateGeo", directionId: d.id, city: body.city },
            explanation: `Вы изменили город показа: было «${d.city}», стало «${body.city}».`,
          });
        }
        break;
      case "goal": {
        const current = await store().getBusiness(business.id);
        const before = current.csoSource.kind === "user" ? `до ${formatRub(current.csoSource.goal)} за обращение` : "подбирать автоматически";
        if (body.goal.mode === "user") {
          jobs.push({
            command: { type: "SetGoal", source: { kind: "user", goal: body.goal.rub * 100 } },
            explanation: `Вы изменили цель: было «${before}», стало «до ${formatRub(body.goal.rub * 100)} за обращение».`,
          });
        } else {
          jobs.push({
            command: { type: "SetGoal", source: { kind: "auto", reference: interimAutoGoalRub(current.monthlyBudgetRub) * 100 } },
            explanation: `Вы изменили цель: было «${before}», стало «подбирать автоматически».`,
          });
        }
        break;
      }
      case "adText":
        jobs.push({ command: { type: "UpdateAdText", adId: body.adId, title: body.title, text: body.text }, explanation: "Вы изменили текст объявления." });
        break;
      case "card": {
        const current = await store().getBusiness(business.id);
        const before = servicesText(current.card.services);
        const after = servicesText(body.card.services);
        jobs.push({
          command: { type: "UpdateCard", card: body.card },
          explanation: before === after ? "Вы изменили описание бизнеса." : `Вы изменили описание бизнеса: услуги были «${before}», стали «${after}».`,
        });
        break;
      }
      case "adStatus":
        jobs.push({
          command: body.active ? { type: "ResumeAd", adId: body.adId } : { type: "PauseAd", adId: body.adId },
          explanation: body.active ? "Вы включили объявление." : "Вы отключили объявление.",
        });
        break;
    }
    const jobIds: string[] = [];
    for (const job of jobs) {
      jobIds.push(await enqueueWebJob({ kind: "command", businessId: business.id, command: job.command, explanation: job.explanation }));
    }
    return { jobIds };
  });
}
