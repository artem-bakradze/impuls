import "server-only";
import type { z } from "zod";
import { ApiError } from "./errors";

export const parseBody = async <S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_PAYLOAD", "Проверьте введённые данные");
  }
  return parsed.data;
};
