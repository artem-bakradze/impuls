/** Worker errors whose Russian message is safe to show as is. Anything else gets a generic text. */
const USER_FACING_CODES = new Set(["ALREADY_LAUNCHED", "EMPTY_PLAN", "CLIENTS_OUT_OF_RANGE"]);

export type JobView =
  | { state: "pending" }
  | { state: "done"; output: unknown }
  | { state: "failed"; error: { code: string; message: string } };

export const GENERIC_JOB_ERROR = "Не получилось применить изменение. Попробуйте ещё раз — если не выйдет, напишите в поддержку";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** pg-boss stores the serialized error (name, message, own fields like `code`) as the output of a failed job. */
export const mapJobState = (state: string, output: unknown): JobView => {
  if (state === "completed") {
    return { state: "done", output };
  }
  if (state === "failed" || state === "cancelled") {
    const code = isRecord(output) && typeof output.code === "string" ? output.code : "JOB_FAILED";
    const message = isRecord(output) && typeof output.message === "string" && USER_FACING_CODES.has(code) ? output.message : GENERIC_JOB_ERROR;
    return { state: "failed", error: { code, message } };
  }
  return { state: "pending" };
};
