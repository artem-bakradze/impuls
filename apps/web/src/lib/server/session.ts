import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { findBusiness } from "./business";
import type { BusinessRow } from "./business";
import { ApiError } from "./errors";
import { userExists } from "./users";
export { homePath } from "../home-path";

/** Signed-in user, or null when there is no valid session or the account no longer exists. */
export const currentUserId = async (): Promise<string | null> => {
  const session = await auth();
  const userId = session?.userId;
  if (userId === undefined || !(await userExists(userId))) {
    return null;
  }
  return userId;
};

export const requireUserId = async (): Promise<string> => {
  const userId = await currentUserId();
  if (userId === null) {
    redirect("/");
  }
  return userId;
};

/** Pages after launch; before launch the user is sent back to the wizard. */
export const requireLaunchedBusiness = async (): Promise<{ userId: string; business: BusinessRow }> => {
  const userId = await requireUserId();
  const business = await findBusiness(userId);
  if (!business?.launchedOn) {
    redirect("/wizard");
  }
  return { userId, business };
};

export const apiUserId = async (): Promise<string> => {
  const userId = await currentUserId();
  if (userId === null) {
    throw new ApiError(401, "UNAUTHORIZED", "Войдите, чтобы продолжить");
  }
  return userId;
};

/** The business is always resolved from the session, never from request arguments. */
export const apiLaunchedBusiness = async (): Promise<BusinessRow> => {
  const business = await findBusiness(await apiUserId());
  if (!business) {
    throw new ApiError(404, "NO_BUSINESS", "Сначала расскажите о бизнесе в мастере запуска");
  }
  if (!business.launchedOn) {
    throw new ApiError(409, "NOT_LAUNCHED", "Реклама ещё не запущена");
  }
  return business;
};
