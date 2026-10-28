import { monthBudget } from "@impuls/core";
import type { JobContext } from "./context";
import { budgetGuard } from "./jobs";
import { loadBusinessView } from "./state";

const rub = (kopecks: number): string => `${Math.floor(kopecks / 100).toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;

export type BudgetChangePreview =
  | { kind: "ok"; monthBudgetRub: number; message: string }
  | { kind: "will_stop"; monthBudgetRub: number; message: string };

/** Shown before the user confirms a new budget (budget-guard spec: изменение бюджета в течение месяца). */
export const previewBudgetChange = async (ctx: JobContext, businessId: string, newMonthlyBudgetRub: number): Promise<BudgetChangePreview> => {
  const view = await loadBusinessView(ctx.store, businessId, ctx.clock, ctx.platformFor(businessId).capabilities());
  const ceiling = monthBudget(newMonthlyBudgetRub, view.business.launchedOn ?? view.today, view.today);
  if (view.spentMonth >= ceiling) {
    return {
      kind: "will_stop",
      monthBudgetRub: ceiling / 100,
      message: `В этом месяце уже потрачено ${rub(view.spentMonth)} — реклама будет остановлена до 1-го числа.`,
    };
  }
  const prorated = ceiling !== newMonthlyBudgetRub * 100;
  return {
    kind: "ok",
    monthBudgetRub: ceiling / 100,
    message: prorated ? `В этом месяце — до ${rub(ceiling)}, дальше — ${rub(newMonthlyBudgetRub * 100)} в месяц.` : `Больше ${rub(ceiling)} за месяц мы не потратим.`,
  };
};

/** Applies a new budget immediately and lets the budget guard act on it in the same call. */
export const changeBudget = async (
  ctx: JobContext,
  businessId: string,
  newMonthlyBudgetRub: number,
  confirmed: boolean,
): Promise<BudgetChangePreview & { applied: boolean }> => {
  const preview = await previewBudgetChange(ctx, businessId, newMonthlyBudgetRub);
  if (preview.kind === "will_stop" && !confirmed) {
    return { ...preview, applied: false };
  }
  const business = await ctx.store.getBusiness(businessId);
  const before = business.monthlyBudgetRub;
  await ctx.store.saveBusiness({ ...business, monthlyBudgetRub: newMonthlyBudgetRub });
  await ctx.store.appendChange({
    businessId,
    actor: "user",
    author: "user",
    action: { type: "ExternalChange" },
    objectKind: "business",
    objectId: businessId,
    before: { monthlyBudgetRub: before },
    after: { monthlyBudgetRub: newMonthlyBudgetRub },
    status: "applied",
    reasonCode: "USER_BUDGET",
    explanation: `Вы изменили бюджет: было ${rub(before * 100)} в месяц, стало ${rub(newMonthlyBudgetRub * 100)}.`,
    turnId: null,
    createdAt: ctx.clock.now(),
    error: null,
    revertedById: null,
    outcome: null,
  });
  await budgetGuard(ctx, businessId);
  return { ...preview, applied: true };
};
