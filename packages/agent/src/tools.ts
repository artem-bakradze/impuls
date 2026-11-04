import type { Command, HypothesisKind, InsightDraft } from "@impuls/core";
import { z } from "zod";
import type { HypothesisDraft, ObservationDraft } from "./runtime";

/**
 * Function tools exposed to the agent (ad-agent spec). Business and account are bound to the turn on the server,
 * so no tool takes a business ID. Money arguments are whole rubles; they are converted to kopecks here.
 */
const insightFields = {
  reasonCode: z.string().min(1).describe("Короткий код причины, например SCALE_EFFECTIVE"),
  observation: z.string().min(1).describe("Что заметили: одно-два предложения для владельца простым языком; все числа — из фактов снимка"),
  factKeys: z.array(z.string().min(1)).min(2).max(4).describe("Ключи 2–4 фактов из snapshot.facts, на которых основан вывод"),
  next: z.string().min(1).describe("Что дальше: для действия — чего сервис ждёт от решения (направление изменения, без новых чисел), затем к какому дню проверит; для наблюдения — к какому дню вернётся к вопросу"),
};
const insight = z.object(insightFields).strict();

const id = z.string().min(1);

const actionSchemas = {
  set_spend_limit: z.object({ directionId: id, weeklyLimitRub: z.number().int().positive(), insight }).strict(),
  set_strategy: z.object({ directionId: id, strategyId: id, insight }).strict(),
  pause_ad: z.object({ adId: id, replacementAdId: id.optional(), insight }).strict(),
  resume_ad: z.object({ adId: id, insight }).strict(),
  pause_direction: z.object({ directionId: id, insight }).strict(),
  resume_direction: z.object({ directionId: id, insight }).strict(),
  update_schedule: z.object({ directionId: id, schedule: z.string().min(1), insight }).strict(),
  update_ad_text: z.object({ adId: id, title: z.string().min(1).max(56), text: z.string().min(1).max(81), insight }).strict(),
  start_experiment: z
    .object({ directionId: id, adId: id, kind: z.enum(["offer", "title", "benefit"]).describe("Что меняет вариант: оффер, заголовок или выгоду"), insight })
    .strict(),
  add_negative_keywords: z
    .object({
      directionId: id,
      phrases: z.array(z.string().min(1).max(100)).min(1).max(10).describe("Минус-фразы: слово или несколько слов из запросов «дороже цели», не из своих основных запросов"),
      insight,
    })
    .strict(),
  set_device_adjustment: z
    .object({
      directionId: id,
      device: z.enum(["mobile", "desktop"]).describe("mobile — телефоны; desktop — компьютеры и планшеты"),
      percent: z.number().int().min(-100).max(100).describe("Новая корректировка цены перехода в процентах: −50…+50, не больше 25 пунктов от текущей за раз"),
      insight,
    })
    .strict(),
} as const;

const readSchemas = {
  get_snapshot: z.object({}).strict(),
  get_history: z.object({ limit: z.number().int().positive().max(50) }).strict(),
  get_recent_insights: z.object({}).strict(),
  get_breakdown: z.object({ directionId: id, dimension: z.enum(["query", "device"]).describe("query — поисковые запросы; device — устройства") }).strict(),
  get_hypotheses: z.object({}).strict(),
} as const;

const hypothesisSchemas = {
  save_hypothesis: z
    .object({
      id: id.optional().describe("Не указывать для новой гипотезы; id из get_hypotheses — чтобы закрыть или обновить"),
      statement: z.string().min(1).describe("Что проверяем — простыми словами; все числа — из фактов"),
      factKeys: z.array(z.string().min(1)).min(2).max(4).describe("Ключи 2–4 фактов хода: при открытии — на чём основана, при закрытии — на чём основан результат"),
      check: z.string().min(1).describe("Как и к какому дню проверим"),
      checkOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("День проверки, YYYY-MM-DD"),
      status: z.enum(["checking", "confirmed", "rejected", "dropped"]).describe("checking — проверяем; confirmed — подтвердилась; rejected — не подтвердилась; dropped — снята"),
      result: z.string().min(1).optional().describe("При закрытии: что выяснили, с числами из фактов"),
    })
    .strict(),
} as const;

const observationSchemas = {
  report_insight: z
    .object({ ...insightFields, decision: z.string().min(1).describe("Что решили: почему пока ничего не меняем") })
    .strict(),
} as const;

export type ActionToolName = keyof typeof actionSchemas;
export type ToolName = ActionToolName | keyof typeof readSchemas | keyof typeof observationSchemas | keyof typeof hypothesisSchemas;

const descriptions: Record<ToolName, string> = {
  set_spend_limit: "Изменить недельный лимит расходов направления (в рублях). Ограничители могут урезать или отклонить.",
  set_strategy: "Сменить стратегию направления на стратегию из каталога площадки.",
  pause_ad: "Отключить объявление. Последнее объявление направления можно отключить только с заменой.",
  resume_ad: "Включить объявление.",
  pause_direction: "Остановить направление целиком.",
  resume_direction: "Снова включить направление.",
  update_schedule: "Изменить расписание показов направления.",
  update_ad_text: "Изменить заголовок и текст объявления (до 56 и 81 символа).",
  start_experiment: "Запустить A/B-проверку для объявления с пограничной эффективностью: сервис сам подготовит вариант с одним изменением.",
  add_negative_keywords:
    "Добавить минус-фразы к рекламе, чтобы она не показывалась по запросам «дороже цели» из get_breakdown. Нельзя минусовать слова своих основных запросов. Не больше 10 фраз в день.",
  set_device_adjustment:
    "Изменить цену перехода с телефонов или компьютеров в процентах, когда устройство в get_breakdown «дороже цели» или заметно дешевле. Диапазон −50…+50, шаг до 25 пунктов, не чаще раза в 7 дней.",
  get_snapshot: "Получить свежий снимок: бизнес, цель, бюджет, направления, объявления, классы эффективности и перечень фактов для инсайтов.",
  get_history: "Получить последние изменения и откаты пользователя.",
  get_recent_insights: "Получить инсайты за 14 дней, чтобы не повторять уже сделанные выводы.",
  get_breakdown:
    "Получить разрез рекламы за 14 дней по поисковым запросам или устройствам: показы, переходы, расход, обращения, цена обращения и вердикт сервиса. Факты строк добавляются в перечень фактов хода.",
  get_hypotheses: "Получить журнал гипотез: открытые и закрытые за 14 дней.",
  save_hypothesis: "Записать новую гипотезу (без id, статус checking) или закрыть открытую (id, статус confirmed, rejected или dropped, result). Открытых — не больше 10.",
  report_insight: "Сообщить владельцу наблюдение без действия: что заметили, на каких фактах, почему пока ничего не меняем и что дальше.",
};

/** Tool definitions in the function-tool format (JSON Schema parameters). */
export const toolDefinitions = (): { name: ToolName; description: string; parameters: unknown }[] =>
  (Object.entries({ ...actionSchemas, ...readSchemas, ...observationSchemas, ...hypothesisSchemas }) as [ToolName, z.ZodType][]).map(([name, schema]) => ({
    name,
    description: descriptions[name],
    parameters: z.toJSONSchema(schema),
  }));

export const isActionTool = (name: string): name is ActionToolName => name in actionSchemas;

export type ParsedAction = { ok: true; command: Command; insight: InsightDraft } | { ok: false; message: string };

const rub = (value: number): number => value * 100;

/** Validates raw tool arguments from the model and turns them into a domain command. */
export const parseActionCall = (name: string, args: unknown): ParsedAction => {
  if (!isActionTool(name)) {
    return { ok: false, message: `нет такого инструмента: ${name}` };
  }
  const parsed = actionSchemas[name].safeParse(args);
  if (!parsed.success) {
    return { ok: false, message: insightProblem(parsed.error.issues) ?? `неверные аргументы: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}` };
  }
  const a = parsed.data as unknown as Record<string, string | number | undefined> & { insight: InsightDraft };
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
      case "update_ad_text":
        return { type: "UpdateAdText", adId: String(a.adId), title: String(a.title), text: String(a.text) };
      case "start_experiment":
        return { type: "StartExperiment", directionId: String(a.directionId), adId: String(a.adId), kind: a.kind as HypothesisKind, hypothesis: "" };
      case "add_negative_keywords":
        return { type: "AddNegativeKeywords", directionId: String(a.directionId), phrases: (parsed.data as unknown as { phrases: string[] }).phrases };
      case "set_device_adjustment":
        return { type: "SetDeviceAdjustment", directionId: String(a.directionId), device: a.device === "desktop" ? "desktop" : "mobile", percent: Number(a.percent) };
    }
  })();
  return { ok: true, command, insight: a.insight };
};

/** A plain reason when the insight of an action is missing or incomplete. */
const insightProblem = (issues: readonly z.core.$ZodIssue[]): string | null =>
  issues.some((i) => i.path[0] === "insight" || ["observation", "factKeys", "next", "decision", "reasonCode"].includes(String(i.path[0])))
    ? "нужен инсайт: что заметили, 2–4 факта из снимка и что дальше"
    : null;

export type ParsedHypothesis = { ok: true; draft: HypothesisDraft } | { ok: false; message: string };

/** Validates `save_hypothesis` arguments. */
export const parseHypothesisCall = (args: unknown): ParsedHypothesis => {
  const parsed = hypothesisSchemas.save_hypothesis.safeParse(args);
  if (!parsed.success) {
    return { ok: false, message: `неверные аргументы: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}` };
  }
  const { id: hypothesisId, result, ...rest } = parsed.data;
  return { ok: true, draft: { ...rest, ...(hypothesisId !== undefined && { id: hypothesisId }), ...(result !== undefined && { result }) } };
};

export type ParsedObservation = { ok: true; insight: ObservationDraft } | { ok: false; message: string };

/** Validates `report_insight` arguments. */
export const parseObservationCall = (args: unknown): ParsedObservation => {
  const parsed = observationSchemas.report_insight.safeParse(args);
  if (!parsed.success) {
    return { ok: false, message: insightProblem(parsed.error.issues) ?? "неверные аргументы" };
  }
  return { ok: true, insight: parsed.data };
};
