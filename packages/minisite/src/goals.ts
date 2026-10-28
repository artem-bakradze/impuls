export const MINI_SITE_GOALS = ["call", "messenger", "booking", "route"] as const;

export type MiniSiteGoalId = (typeof MINI_SITE_GOALS)[number];

export interface MetrikaGoalDefinition {
  /** Identifier passed to `ym(counter, "reachGoal", identifier)`. */
  identifier: MiniSiteGoalId;
  /** Goal name shown to the user in Metrika (Russian). */
  name: string;
  /** Metrika Management API goal type for JavaScript events. */
  type: "action";
}

const GOAL_NAMES: Record<MiniSiteGoalId, string> = {
  call: "Звонок",
  messenger: "Переход в мессенджер",
  booking: "Переход к онлайн-записи",
  route: "Построение маршрута",
};

/** Goals the worker creates via Metrika Management API for every mini-site counter. */
export const metrikaGoals = (): MetrikaGoalDefinition[] =>
  MINI_SITE_GOALS.map((identifier) => ({ identifier, name: GOAL_NAMES[identifier], type: "action" }));
