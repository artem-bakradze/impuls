import type { Command } from "@impuls/core";
import { z } from "zod";
import type { Justification } from "./runtime";

/**
 * Function tools exposed to the agent (ad-agent spec). Business and account are bound to the turn on the server,
 * so no tool takes a business ID. Money arguments are whole rubles; they are converted to kopecks here.
 */
const justification = z
  .object({
    reasonCode: z.string().min(1).describe("Короткий код причины, например SCALE_EFFECTIVE"),
    text: z.string().min(1).describe("Объяснение для владельца бизнеса простым языком; все числа — из снимка"),
  })
  .strict();

const id = z.string().min(1);

const actionSchemas = {
  set_spend_limit: z.object({ directionId: id, weeklyLimitRub: z.number().int().positive(), justification }).strict(),
  set_strategy: z.object({ directionId: id, strategyId: id, justification }).strict(),
  pause_ad: z.object({ adId: id, replacementAdId: id.optional(), justification }).strict(),
  resume_ad: z.object({ adId: id, justification }).strict(),
  pause_direction: z.object({ directionId: id, justification }).strict(),
  resume_direction: z.object({ directionId: id, justification }).strict(),
  update_schedule: z.object({ directionId: id, schedule: z.string().min(1), justification }).strict(),
  update_geo: z.object({ directionId: id, radiusKm: z.number().positive().max(100), justification }).strict(),
  update_ad_text: z.object({ adId: id, title: z.string().min(1).max(56), text: z.string().min(1).max(81), justification }).strict(),
  start_experiment: z.object({ directionId: id, adId: id, hypothesis: z.string().min(1).max(300), variantAdId: id.optional(), justification }).strict(),
} as const;

const memorySchemas = {
  save_note: z.object({ text: z.string().min(1).max(500) }).strict(),
  delete_note: z.object({ index: z.number().int().nonnegative() }).strict(),
} as const;

const readSchemas = {
  get_snapshot: z.object({}).strict(),
  get_history: z.object({ limit: z.number().int().positive().max(50) }).strict(),
  get_notes: z.object({}).strict(),
} as const;

export type ActionToolName = keyof typeof actionSchemas;
export type ToolName = ActionToolName | keyof typeof memorySchemas | keyof typeof readSchemas;

const descriptions: Record<ToolName, string> = {
  set_spend_limit: "Изменить недельный лимит расходов направления (в рублях). Ограничители могут урезать или отклонить.",
  set_strategy: "Сменить стратегию направления на стратегию из каталога площадки.",
  pause_ad: "Отключить объявление. Последнее объявление направления можно отключить только с заменой.",
  resume_ad: "Включить объявление.",
  pause_direction: "Остановить направление целиком.",
  resume_direction: "Снова включить направление.",
  update_schedule: "Изменить расписание показов направления.",
  update_geo: "Изменить радиус зоны показа направления, км.",
  update_ad_text: "Изменить заголовок и текст объявления (до 56 и 81 символа).",
  start_experiment: "Запустить A/B-проверку для объявления с пограничной эффективностью.",
  save_note: "Сохранить заметку для следующих ходов (до 500 символов, без персональных данных).",
  delete_note: "Удалить заметку по номеру.",
  get_snapshot: "Получить свежий снимок: бизнес, цель, бюджет, направления, объявления, классы эффективности.",
  get_history: "Получить последние изменения и откаты пользователя.",
  get_notes: "Прочитать свои заметки из прошлых ходов.",
};

/** Tool definitions in the function-tool format (JSON Schema parameters). */
export const toolDefinitions = (): { name: ToolName; description: string; parameters: unknown }[] =>
  (Object.entries({ ...actionSchemas, ...memorySchemas, ...readSchemas }) as [ToolName, z.ZodType][]).map(([name, schema]) => ({
    name,
    description: descriptions[name],
    parameters: z.toJSONSchema(schema),
  }));

export const isActionTool = (name: string): name is ActionToolName => name in actionSchemas;

export type ParsedAction = { ok: true; command: Command; justification: Justification } | { ok: false; message: string };

const rub = (value: number): number => value * 100;

/** Validates raw tool arguments from the model and turns them into a domain command. */
export const parseActionCall = (name: string, args: unknown): ParsedAction => {
  if (!isActionTool(name)) {
    return { ok: false, message: `нет такого инструмента: ${name}` };
  }
  const parsed = actionSchemas[name].safeParse(args);
  if (!parsed.success) {
    const missingJustification = parsed.error.issues.some((i) => i.path[0] === "justification");
    return {
      ok: false,
      message: missingJustification ? "нужно обоснование: код причины и текст для владельца бизнеса" : `неверные аргументы: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    };
  }
  const a = parsed.data as unknown as Record<string, string | number | undefined> & { justification: Justification };
  const command = ((): Command => {
    switch (name) {
      case "set_spend_limit":
        return { type: "SetSpendLimit", directionId: String(a.directionId), weeklyLimit: rub(Number(a.weeklyLimitRub)) };
      case "set_strategy":
        return { type: "SetStrategy", directionId: String(a.directionId), strategyId: String(a.strategyId) };
      case "pause_ad":
        return a.replacementAdId === undefined
          ? { type: "PauseAd", adId: String(a.adId) }
          : { type: "PauseAd", adId: String(a.adId), replacementAdId: String(a.replacementAdId) };
      case "resume_ad":
        return { type: "ResumeAd", adId: String(a.adId) };
      case "pause_direction":
        return { type: "PauseDirection", directionId: String(a.directionId) };
      case "resume_direction":
        return { type: "ResumeDirection", directionId: String(a.directionId) };
      case "update_schedule":
        return { type: "UpdateSchedule", directionId: String(a.directionId), schedule: String(a.schedule) };
      case "update_geo":
        return { type: "UpdateGeo", directionId: String(a.directionId), radiusKm: Number(a.radiusKm) };
      case "update_ad_text":
        return { type: "UpdateAdText", adId: String(a.adId), title: String(a.title), text: String(a.text) };
      case "start_experiment":
        return a.variantAdId === undefined
          ? { type: "StartExperiment", directionId: String(a.directionId), adId: String(a.adId), hypothesis: String(a.hypothesis) }
          : { type: "StartExperiment", directionId: String(a.directionId), adId: String(a.adId), hypothesis: String(a.hypothesis), variantAdId: String(a.variantAdId) };
    }
  })();
  return { ok: true, command, justification: a.justification };
};
