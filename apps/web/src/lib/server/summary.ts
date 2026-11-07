import "server-only";
import { addDays, costPerLead, daysBetween, emptyStats, endOfMonth, monthKey, toLocalDate, weekStart } from "@impuls/core";
import type { LocalDate, PerformanceStats } from "@impuls/core";
import { measurementFromCard } from "../measurement";
import { isStepComplete } from "@impuls/worker/simulation-report";
import { aggregate, isAdDecision, loadBusinessView, weeklyClientCost } from "@impuls/worker";
import { budgetForecast, budgetPlan, evenPeriods, observedDaily } from "../summary-model";
import { buildInsightFeed } from "./insights";
import type { SummaryModel, SummaryPeriod } from "../summary-model";
import { businessClock, platformCapabilities, readOnlyContext } from "./read-context";
import { store } from "./runtime";

const DAY_MS = 86_400_000;
/** Genitive month names: «до конца октября», «с 1 ноября». */
const MONTHS_OF = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const NOTIFICATION_WINDOW_DAYS = 14;

const periodRange = (period: SummaryPeriod, today: LocalDate): { from: LocalDate; to: LocalDate; prevFrom: LocalDate; prevTo: LocalDate } => {
  if (period === "week") {
    return { from: addDays(today, -6), to: today, prevFrom: addDays(today, -13), prevTo: addDays(today, -7) };
  }
  const from = `${monthKey(today)}-01`;
  const prevTo = addDays(from, -1);
  const prevFrom = `${monthKey(prevTo)}-01`;
  // Same number of days into the previous month, so the comparison is fair.
  const span = Number(today.slice(8, 10)) - 1;
  const sameDay = addDays(prevFrom, span);
  return { from, to: today, prevFrom, prevTo: sameDay < prevTo ? sameDay : prevTo };
};

const total = (rows: Awaited<ReturnType<ReturnType<typeof store>["stats"]>>): PerformanceStats => aggregate(rows, () => "all").get("all") ?? emptyStats();

/** Everything the summary screen shows (analytics spec «Сводка»), computed from the store only. */
export const buildSummary = async (businessId: string, period: SummaryPeriod): Promise<SummaryModel> => {
  const s = store();
  const ctx = readOnlyContext(await businessClock(businessId));
  const view = await loadBusinessView(s, businessId, ctx.clock, platformCapabilities((await s.getBusiness(businessId)).mode));
  const { business, today } = view;
  const range = periodRange(period, today);
  const [rows, prevRows, changes, notifications, confirmations, feed, simulation] = await Promise.all([
    s.stats(businessId, range.from, range.to),
    s.stats(businessId, range.prevFrom, range.prevTo),
    s.changes(businessId),
    s.notifications(businessId),
    s.clientConfirmations(businessId),
    buildInsightFeed(businessId, { since: range.from }),
    business.mode === "simulation" ? s.getSimulation(businessId) : Promise.resolve(null),
  ]);
  const current = total(rows);
  const previous = total(prevRows);
  const allRows = await s.stats(businessId, business.launchedOn ?? today, today);

  const clientsIn = (from: LocalDate, to: LocalDate): number | null => {
    const weeks = confirmations.filter((c) => c.weekStart >= weekStart(from) && c.weekStart <= to);
    return weeks.length === 0 ? null : weeks.reduce((sum, c) => sum + c.clients, 0);
  };

  const lastWeek = weekStart(addDays(today, -7));
  const clientCost = await weeklyClientCost(ctx, businessId, lastWeek);
  const lastWeekLeads = total(await s.stats(businessId, lastWeek, addDays(lastWeek, 6))).leads;
  const answered = confirmations.some((c) => c.weekStart === lastWeek);

  const now = ctx.clock.now().getTime();

  const campaignToDirection = new Map(view.directions.map((d) => [d.platformCampaignId, d.id]));
  const byDirection = aggregate(rows, (r) => campaignToDirection.get(r.campaignId) ?? r.campaignId);
  const cpl = costPerLead(current);
  const cso = view.cso;

  const launchedOn = business.launchedOn ?? today;
  const launchMonth =
    monthKey(today) === monthKey(launchedOn) && launchedOn.slice(8, 10) !== "01"
      ? {
          budget: view.monthBudget,
          monthName: MONTHS_OF[Number(launchedOn.slice(5, 7)) - 1] ?? "",
          nextMonthName: MONTHS_OF[Number(launchedOn.slice(5, 7)) % 12] ?? "",
        }
      : null;
  const status = cpl === null ? "no_data" : cpl <= cso ? "within" : "above";

  const allPaused = view.directions.length > 0 && view.directions.every((d) => d.status === "paused");
  const moderation = { pending: 0, accepted: 0, rejected: 0 };
  for (const ad of view.ads) {
    moderation[ad.moderation]++;
  }

  return {
    timeZone: business.timeZone,
    measurement: measurementFromCard(business.card, business.mode === "simulation"),
    dataPeriod: { from: range.from > (business.launchedOn ?? today) ? range.from : (business.launchedOn ?? today), to: range.to, asOf: ctx.clock.now().toISOString(), month: monthKey(today), previousPartial: launchedOn > range.prevFrom },
    daily: evenPeriods(
      observedDaily(range.from > launchedOn ? range.from : launchedOn, range.to, rows, new Set(changes.filter((c) => c.author === "service" && c.status === "applied" && isAdDecision(c)).map((c) => toLocalDate(c.createdAt, business.timeZone)))),
      // The owner's periods of a simulation, from their first day to the day before the morning they end on.
      simulation === null
        ? []
        : simulation.steps
            .filter((s) => s.kind === "period" && isStepComplete(s, simulation))
            .map((s) => ({ from: toLocalDate(s.from, business.timeZone), to: addDays(toLocalDate(s.to, business.timeZone), -1) })),
    ),
    period,
    state: allPaused ? "paused" : allRows.length === 0 ? "first_day" : "running",
    simulation: simulation ? { weeks: simulation.steps.filter((s) => s.kind === "week" && isStepComplete(s, simulation)).length } : null,
    launchedDays: daysBetween(launchedOn, today) + 1,
    // The previous period entirely before the launch: nothing to compare with.
    compare: launchedOn < range.from,
    launchMonth,
    monthlyBudget: business.monthlyBudgetRub * 100,
    moderation,
    monthBudget: view.monthBudget,
    spentMonth: view.spentMonth,
    // The plan up to the last day with numbers: a simulation's today is the morning after the owner's period and has none
    // yet, so counting it said «тратим на 45% меньше плана» after one even day; Direct brings today's spend during the day.
    budgetPlan: budgetPlan(view.monthBudget, monthKey(launchedOn) === monthKey(today) ? launchedOn : `${monthKey(today)}-01`, endOfMonth(today), business.mode === "simulation" ? addDays(today, -1) : today),
    budgetForecast: budgetForecast(view.monthBudget, view.spentMonth, [...view.spendLast7.values()].reduce((sum, v) => sum + v, 0), today),
    spend: { value: current.spend, previous: previous.spend },
    leads: { value: current.leads, previous: previous.leads },
    clients: { value: clientsIn(range.from, range.to), previous: clientsIn(range.prevFrom, range.prevTo) },
    clientCost:
      clientCost.kind === "known"
        ? { kind: "known", costPerClient: clientCost.costPerClient, clients: clientCost.clients, week: lastWeek }
        : // One cost per lead on the summary: the selected period's, as in the goal line (analytics spec).
          { kind: "unknown", costPerLead: cpl, hint: clientCost.hint, week: lastWeek },
    goal: {
      mode: business.csoSource.kind,
      cso,
      learned: business.csoSource.kind === "auto" && cso !== business.csoSource.reference,
      current: cpl,
      status,
    },
    feed,
    decided: changes.some((c) => c.author === "service" && c.status === "applied" && isAdDecision(c)),
    attention: {
      notifications: notifications
        .filter((n) => now - n.at.getTime() <= NOTIFICATION_WINDOW_DAYS * DAY_MS)
        // Advice to raise the goal that the current «в цели» contradicts is out of date.
        .filter((n) => n.kind !== "goal_unreachable" || status === "above")
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, 10)
        .map((n, index) => ({ id: `${n.at.toISOString()}-${index}`, kind: n.kind, message: n.message, at: n.at.toISOString() })),
      // A scenario has no real clients to count (simulation-mode spec).
      clientsQuestion: simulation === null && !answered && lastWeekLeads > 0 ? { week: lastWeek, weekEnd: addDays(lastWeek, 6), leads: lastWeekLeads } : null,
    },
    directions: view.directions.map((d) => {
      const stats = byDirection.get(d.id) ?? emptyStats();
      return {
        id: d.id,
        name: d.name,
        channel: d.channel,
        status: d.status,
        ads: view.ads.filter((a) => a.directionId === d.id && a.status === "active").length,
        weeklyLimit: d.weeklyLimit,
        spend: stats.spend,
        leads: stats.leads,
        costPerLead: costPerLead(stats),
      };
    }),
  };
};
