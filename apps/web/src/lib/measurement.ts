import { z } from "zod";
import type { CounterCheck } from "@impuls/worker";

export interface MeasurementModel {
  status: "unchecked" | "found" | "not_found" | "unreachable";
  counterId: number | null;
  simulated: boolean;
}

export const measurementState = (check: CounterCheck | null, simulated = false): MeasurementModel => ({
  status: check?.status ?? "unchecked", counterId: check?.status === "found" ? check.counterId : null, simulated,
});

const savedCheck = z.object({ siteUrl: z.string(), status: z.enum(["found", "not_found", "unreachable"]), counterId: z.number().nullable() });

/** Old wizard checks remain readable; a check for a previous site is explicitly unknown. */
export const measurementFromCard = (card: unknown, simulated: boolean): MeasurementModel => {
  const value = z.object({ siteUrl: z.string(), measurement: savedCheck.optional(), onboarding: z.object({ counter: savedCheck.nullable().optional() }).optional() }).parse(card);
  const saved = value.measurement ?? value.onboarding?.counter;
  if (!saved || saved.siteUrl !== value.siteUrl) return measurementState(null, simulated);
  return measurementState(saved.status === "found" ? { status: "found", counterId: saved.counterId } : { status: saved.status }, simulated);
};

export const measurementText = (model: MeasurementModel): { title: string; detail: string } => {
  if (model.simulated) return { title: "Учебные обращения", detail: "В симуляции данные создаёт учебный рынок. Устанавливать настоящий счётчик для неё не нужно." };
  if (model.status === "found") return { title: `Счётчик Метрики на сайте есть${model.counterId === null ? "" : ` · № ${model.counterId}`}`, detail: "Счётчик найден; получение обращений пока не подтверждено. Наличие кода ещё не означает, что выбранные действия учитываются." };
  const title = model.status === "unchecked" ? "Учёт обращений ещё не проверен" : model.status === "not_found" ? "Счётчик Метрики на сайте не нашли" : "Не получилось открыть сайт, чтобы проверить счётчик";
  return { title, detail: "Без учёта обращений сервис не сможет понять, какая реклама приводит клиентов. Проверьте счётчик и выбранные действия. Запустить рекламу это не мешает." };
};
