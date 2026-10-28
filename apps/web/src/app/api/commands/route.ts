import type { Command } from "@impuls/core";
import { z } from "zod";
import { AD_TEXT_MAX, AD_TITLE_MAX } from "@/lib/onboarding";
import { handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { parseBody } from "@/lib/server/request";
import { store } from "@/lib/server/runtime";
import { apiLaunchedBusiness } from "@/lib/server/session";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pauseAll") }),
  z.object({ action: z.literal("resumeAll") }),
  z.object({ action: z.literal("schedule"), schedule: z.string().regex(/^(Пн–Вс|Пн–Пт|Пн–Сб) \d{2}:00–\d{2}:00$/) }),
  z.object({ action: z.literal("geo"), radiusKm: z.number().int().min(1).max(50) }),
  z.object({ action: z.literal("adText"), adId: z.string().min(1), title: z.string().trim().min(1).max(AD_TITLE_MAX), text: z.string().trim().min(1).max(AD_TEXT_MAX) }),
  z.object({ action: z.literal("adStatus"), adId: z.string().min(1), active: z.boolean() }),
]);

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
      case "geo":
        for (const d of directions) {
          jobs.push({
            command: { type: "UpdateGeo", directionId: d.id, radiusKm: body.radiusKm },
            explanation: `Вы изменили зону показа: было ${d.geoRadiusKm} км, стало ${body.radiusKm} км.`,
          });
        }
        break;
      case "adText":
        jobs.push({ command: { type: "UpdateAdText", adId: body.adId, title: body.title, text: body.text }, explanation: "Вы изменили текст объявления." });
        break;
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
