import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** Money is stored in kopecks. */
const kopecks = (name: string) => bigint(name, { mode: "number" });

export const objectStatus = pgEnum("object_status", ["active", "paused"]);
export const changeStatus = pgEnum("change_status", ["pending", "applied", "failed"]);
export const changeAuthor = pgEnum("change_author", ["service", "user", "cabinet"]);
export const actor = pgEnum("actor", ["agent", "safety_net", "budget_guard", "user", "reconciliation"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const businesses = pgTable("businesses", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  timeZone: text("time_zone").notNull(),
  monthlyBudgetRub: integer("monthly_budget_rub").notNull(),
  launchedOn: date("launched_on"),
  csoMode: text("cso_mode", { enum: ["user", "auto"] }).notNull(),
  csoValue: kopecks("cso_value").notNull(),
  /** Public business card (allowlisted for the agent). */
  card: jsonb("card").notNull(),
  miniSite: jsonb("mini_site"),
  /** Metrica goal that counts leads; lead-paying strategies need it (platform-integration spec). */
  leadGoalId: text("lead_goal_id"),
  onboardingStep: integer("onboarding_step").notNull().default(1),
  /** «Яндекс Директ» or «Симуляция» (add-simulation-mode); set at launch. */
  mode: text("mode", { enum: ["direct", "simulation"] }).notNull().default("direct"),
  createdAt: createdAt(),
});

/** Virtual time and saved market of a business in the simulation mode (add-simulation-mode). */
export const simulations = pgTable("simulations", {
  businessId: text("business_id").primaryKey().references(() => businesses.id),
  scenario: text("scenario").notNull(),
  seed: bigint("seed", { mode: "number" }).notNull(),
  /** Launch plan, kept for «Начать заново». */
  plan: jsonb("plan").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  simNow: timestamp("sim_now", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  /** Real time of the last tick; null while paused. */
  lastTickAt: timestamp("last_tick_at", { withTimezone: true }),
  /** Virtual milliseconds per real millisecond. */
  speed: integer("speed").notNull(),
  status: text("status", { enum: ["running", "paused", "until_decision", "stepping"] }).notNull(),
  state: jsonb("state").notNull(),
  baseline: jsonb("baseline"),
});

export const platformAccounts = pgTable("platform_accounts", {
  businessId: text("business_id").primaryKey().references(() => businesses.id),
  platform: text("platform").notNull(),
  /** Direct login; null until the worker checks the connected account (bootstrap task 3.2). */
  login: text("login"),
  /** AES-GCM encrypted OAuth tokens; never logged. */
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** One-time `state` values of the Direct OAuth flow; consumed on the first callback, valid for 10 minutes. */
export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** A direction = one platform campaign (design decision 5). */
export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id").notNull().references(() => businesses.id),
    platformCampaignId: text("platform_campaign_id").notNull(),
    name: text("name").notNull(),
    channel: text("channel", { enum: ["search", "network"] }).notNull(),
    status: objectStatus("status").notNull(),
    weeklyLimit: kopecks("weekly_limit").notNull(),
    strategyId: text("strategy_id").notNull(),
    createdOn: date("created_on").notNull(),
    lastLimitIncreaseOn: date("last_limit_increase_on"),
    lastStrategyChangeOn: date("last_strategy_change_on"),
    pausedByBudget: boolean("paused_by_budget").notNull().default(false),
    pausedByUser: boolean("paused_by_user").notNull().default(false),
    schedule: text("schedule").notNull().default(""),
    /** City the campaign is shown in (Direct region of the ad group). */
    city: text("city").notNull().default(""),
    /** Key phrases of the launch plan: a negative phrase must not switch them off (add-agent-analyst-stage1). */
    keywords: jsonb("keywords").notNull().default([]),
    negativeKeywords: jsonb("negative_keywords").notNull().default([]),
    /** Bid adjustments in percent for phones and computers. */
    deviceAdjustments: jsonb("device_adjustments").notNull().default({ mobile: 0, desktop: 0 }),
    /** Day each device's adjustment last changed, for the 7-day pause. */
    deviceAdjustedOn: jsonb("device_adjusted_on").notNull().default({ mobile: null, desktop: null }),
  },
  (t) => [uniqueIndex("campaigns_platform_id").on(t.platformCampaignId), index("campaigns_business").on(t.businessId)],
);

export const ads = pgTable(
  "ads",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id").notNull().references(() => campaigns.id),
    platformAdId: text("platform_ad_id").notNull(),
    status: objectStatus("status").notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    moderation: text("moderation", { enum: ["accepted", "pending", "rejected"] }).notNull().default("pending"),
    createdOn: date("created_on").notNull(),
  },
  (t) => [uniqueIndex("ads_platform_id").on(t.platformAdId), index("ads_campaign").on(t.campaignId)],
);

export const changeLog = pgTable(
  "change_log",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id").notNull().references(() => businesses.id),
    actor: actor("actor").notNull(),
    author: changeAuthor("author").notNull(),
    action: jsonb("action").notNull(),
    objectKind: text("object_kind", { enum: ["direction", "ad", "business", "minisite", "goal", "card"] }).notNull(),
    objectId: text("object_id").notNull(),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    status: changeStatus("status").notNull(),
    reasonCode: text("reason_code").notNull(),
    explanation: text("explanation").notNull(),
    turnId: text("turn_id"),
    /** The insight that explains this decision (insights spec), if the change came from one. */
    insightId: text("insight_id"),
    revertedById: text("reverted_by_id"),
    error: text("error"),
    outcome: text("outcome"),
    createdAt: createdAt(),
  },
  (t) => [index("change_log_business_time").on(t.businessId, t.createdAt), index("change_log_pending").on(t.status).where(sql`status = 'pending'`)],
);

export const userDecisions = pgTable("user_decisions", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  objectId: text("object_id").notNull(),
  commandType: text("command_type").notNull(),
  on: date("on").notNull(),
});

export const statsDaily = pgTable(
  "stats_daily",
  {
    businessId: text("business_id").notNull().references(() => businesses.id),
    date: date("date").notNull(),
    platformCampaignId: text("platform_campaign_id").notNull(),
    platformAdId: text("platform_ad_id").notNull(),
    impressions: integer("impressions").notNull(),
    clicks: integer("clicks").notNull(),
    leads: integer("leads").notNull(),
    costVat: kopecks("cost_vat").notNull(),
    loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.date, t.platformAdId] })],
);

export const statsIntraday = pgTable(
  "stats_intraday",
  {
    businessId: text("business_id").notNull().references(() => businesses.id),
    platformAdId: text("platform_ad_id").notNull(),
    impressions: integer("impressions").notNull(),
    clicks: integer("clicks").notNull(),
    leads: integer("leads").notNull(),
    costVat: kopecks("cost_vat").notNull(),
    loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.platformAdId] })],
);

export const experiments = pgTable("experiments", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id),
  adId: text("ad_id").notNull(),
  variantAdId: text("variant_ad_id"),
  hypothesis: text("hypothesis").notNull(),
  startedOn: date("started_on").notNull(),
  status: text("status", { enum: ["running", "finished"] }).notNull(),
  outcome: jsonb("outcome"),
});

/** The agent's memory between turns: what it checks, on which facts, by when, and what came out (ad-agent spec). */
export const hypotheses = pgTable(
  "hypotheses",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id").notNull().references(() => businesses.id),
    openedTurnId: text("opened_turn_id"),
    closedTurnId: text("closed_turn_id"),
    statement: text("statement").notNull(),
    facts: jsonb("facts").notNull(),
    check: text("check").notNull(),
    checkOn: date("check_on").notNull(),
    status: text("status", { enum: ["checking", "confirmed", "rejected", "dropped"] }).notNull(),
    result: text("result"),
    resultFacts: jsonb("result_facts").notNull().default([]),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("hypotheses_business_time").on(t.businessId, t.openedAt)],
);

export const evaluations = pgTable("evaluations", {
  businessId: text("business_id").primaryKey().references(() => businesses.id),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull(),
  on: date("on").notNull(),
  adClasses: jsonb("ad_classes").notNull(),
  directionClasses: jsonb("direction_classes").notNull(),
  borderlineSince: jsonb("borderline_since").notNull(),
});

export const clientConfirmations = pgTable(
  "client_confirmations",
  {
    businessId: text("business_id").notNull().references(() => businesses.id),
    weekStart: date("week_start").notNull(),
    clients: integer("clients").notNull(),
    leads: integer("leads").notNull(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.weekStart] })],
);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  createdAt: createdAt(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const agentTurns = pgTable("agent_turns", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  trigger: text("trigger").notNull(),
  runtime: text("runtime").notNull(),
  instructionsVersion: text("instructions_version").notNull(),
  status: text("status", { enum: ["running", "completed", "failed", "cancelled"] }).notNull(),
  context: jsonb("context").notNull(),
  calls: jsonb("calls").notNull(),
  summary: text("summary"),
  /** The summary passed the jargon and number checks and is shown as «Разбор дня» (insights spec). */
  summaryValid: boolean("summary_valid").notNull().default(false),
  /** Token usage of the turn and where it came from: the Agents API or the service's estimate (ad-agent spec). */
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  usageSource: text("usage_source", { enum: ["api", "estimate"] }),
  costKopecks: integer("cost_kopecks").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/** Insights: what the service noticed, on which facts, what it decided and what comes next (insights spec). */
export const insights = pgTable(
  "insights",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id").notNull().references(() => businesses.id),
    turnId: text("turn_id"),
    source: text("source", { enum: ["agent", "rule"] }).notNull(),
    reasonCode: text("reason_code").notNull(),
    observation: text("observation").notNull(),
    facts: jsonb("facts").notNull(),
    decision: jsonb("decision").notNull(),
    next: text("next").notNull(),
    /** The ad or direction the insight is about, for «На самом деле» in a simulation. */
    objectRef: jsonb("object_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("insights_business_time").on(t.businessId, t.createdAt)],
);

export const agentInbox = pgTable("agent_inbox", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  event: jsonb("event").notNull(),
  createdAt: createdAt(),
  consumedByTurnId: text("consumed_by_turn_id"),
});

/** Kill switches; business_id '*' is the global value. */
export const runtimeFlags = pgTable(
  "runtime_flags",
  {
    name: text("name", { enum: ["agent_enabled", "automation_enabled"] }).notNull(),
    businessId: text("business_id").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.name, t.businessId] })],
);

export const syncCursors = pgTable(
  "sync_cursors",
  {
    businessId: text("business_id").notNull(),
    name: text("name").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.name] })],
);

export const incidents = pgTable("incidents", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  businessId: text("business_id"),
  message: text("message").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const heartbeats = pgTable("heartbeats", {
  name: text("name").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull(),
});
