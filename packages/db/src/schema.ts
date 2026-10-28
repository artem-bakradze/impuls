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
  autonomy: text("autonomy", { enum: ["auto", "ask"] }).notNull().default("auto"),
  /** Public business card (allowlisted for the agent). */
  card: jsonb("card").notNull(),
  miniSite: jsonb("mini_site"),
  onboardingStep: integer("onboarding_step").notNull().default(1),
  createdAt: createdAt(),
});

export const platformAccounts = pgTable("platform_accounts", {
  businessId: text("business_id").primaryKey().references(() => businesses.id),
  platform: text("platform").notNull(),
  login: text("login").notNull(),
  /** AES-GCM encrypted OAuth tokens; never logged. */
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
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
    schedule: text("schedule").notNull().default(""),
    geoRadiusKm: integer("geo_radius_km").notNull().default(3),
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
    objectKind: text("object_kind", { enum: ["direction", "ad", "business", "minisite"] }).notNull(),
    objectId: text("object_id").notNull(),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    status: changeStatus("status").notNull(),
    reasonCode: text("reason_code").notNull(),
    explanation: text("explanation").notNull(),
    turnId: text("turn_id"),
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
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const agentNotes = pgTable("agent_notes", {
  businessId: text("business_id").primaryKey().references(() => businesses.id),
  notes: jsonb("notes").notNull(),
});

export const agentInbox = pgTable("agent_inbox", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  event: jsonb("event").notNull(),
  createdAt: createdAt(),
  consumedByTurnId: text("consumed_by_turn_id"),
});

export const approvalRequests = pgTable("approval_requests", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businesses.id),
  command: jsonb("command").notNull(),
  objectId: text("object_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  explanation: text("explanation").notNull(),
  turnId: text("turn_id").notNull(),
  status: text("status", { enum: ["pending", "approved", "declined", "expired"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
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
