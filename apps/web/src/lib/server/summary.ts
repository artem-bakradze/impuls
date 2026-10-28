import "server-only";
import { addDays, costPerLead, emptyStats, monthKey, weekStart } from "@impuls/core";
import type { LocalDate, PerformanceStats } from "@impuls/core";
import { aggregate, loadBusinessView, weeklyClientCost } from "@impuls/worker";
import type { SummaryModel, SummaryPeriod } from "../summary-model";
import { platformCapabilities, readOnlyContext } from "./read-context";
import { store } from "./runtime";

const ACTIONS_WINDOW_DAYS = 7;
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
  const ctx = readOnlyContext();
  const view = await loadBusinessView(s, businessId, ctx.clock, platformCapabilities());
  const { business, today } = view;
  const range = periodRange(period, today);
  const [rows, prevRows, changes, notifications, approvals, confirmations] = await Promise.all([
    s.stats(businessId, range.from, range.to),
    s.stats(businessId, range.prevFrom, range.prevTo),
    s.changes(businessId),
    s.notifications(businessId),
    s.approvals(businessId),
    s.clientConfirmations(businessId),
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
  const actions = changes
    .filter((c) => c.author === "service" && c.status === "applied" && now - c.createdAt.getTime() <= ACTIONS_WINDOW_DAYS * 86_400_000)
    .reverse()
    .slice(0, 10)
    .map((c) => ({ id: c.id, at: c.createdAt.toISOString(), text: c.explanation }));

  const campaignToDirection = new Map(view.directions.map((d) => [d.platformCampaignId, d.id]));
  const byDirection = aggregate(rows, (r) => campaignToDirection.get(r.campaignId) ?? r.campaignId);
  const cpl = costPerLead(current);
  const cso = view.cso;

  const allPaused = view.directions.length > 0 && view.directions.every((d) => d.status === "paused");
  const moderation = { pending: 0, accepted: 0, rejected: 0 };
  for (const ad of view.ads) {
    moderation[ad.moderation]++;
  }

  return {
    timeZone: business.timeZone,
    period,
    state: allPaused ? "paused" : allRows.length === 0 ? "first_day" : "running",
    moderation,
    monthBudget: view.monthBudget,
    spentMonth: view.spentMonth,
    spend: { value: current.spend, previous: previous.spend },
    leads: { value: current.leads, previous: previous.leads },
    clients: { value: clientsIn(range.from, range.to), previous: clientsIn(range.prevFrom, range.prevTo) },
    clientCost:
      clientCost.kind === "known"
        ? { kind: "known", costPerClient: clientCost.costPerClient, clients: clientCost.clients, week: lastWeek }
        : { kind: "unknown", costPerLead: clientCost.costPerLead, hint: clientCost.hint, week: lastWeek },
    goal: {
      mode: business.csoSource.kind,
      cso,
      current: cpl,
      status: cpl === null ? "no_data" : cpl <= cso ? "within" : "above",
    },
    actions,
    attention: {
      notifications: notifications
        .filter((n) => now - n.at.getTime() <= NOTIFICATION_WINDOW_DAYS * 86_400_000)
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, 10)
        .map((n, index) => ({ id: `${n.at.toISOString()}-${index}`, kind: n.kind, message: n.message, at: n.at.toISOString() })),
      approvals: approvals
        .filter((a) => a.status === "pending")
        .map((a) => ({ id: a.id, explanation: a.explanation, at: a.createdAt.toISOString() })),
      clientsQuestion: !answered && lastWeekLeads > 0 ? { week: lastWeek, weekEnd: addDays(lastWeek, 6), leads: lastWeekLeads } : null,
    },
    directions: view.directions.map((d) => {
      const stats = byDirection.get(d.id) ?? emptyStats();
      return {
        id: d.id,
        name: d.name,
        channel: d.channel,
        status: d.status,
        spend: stats.spend,
        leads: stats.leads,
        costPerLead: costPerLead(stats),
      };
    }),
  };
};
