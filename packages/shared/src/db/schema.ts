import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigint,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/* ---------------------------------- enums --------------------------------- */

export const taskPlatformEnum = pgEnum("task_platform", [
  "x",
  "linkedin",
  "reddit",
  "chrome_web_store",
  "other",
]);
export const taskStatusEnum = pgEnum("task_status", ["pending", "approved", "rejected"]);
export const payoutMethodEnum = pgEnum("payout_method", [
  "paypal",
  "stripe_connect",
  "wise",
  "usdc",
  "usdt",
]);
export const payoutStatusEnum = pgEnum("payout_status", [
  "requested",
  "auditing",
  "approved",
  "paid",
  "rejected",
  "frozen",
]);
export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "active",
  "paused",
  "exhausted",
  "rejected",
]);
export const moderationDecisionEnum = pgEnum("moderation_decision", [
  "auto_approved",
  "auto_rejected",
  "needs_review",
]);
export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "welcome_bonus",
  "ad_revenue_share",
  "social_task_reward",
  "advertiser_deposit",
  "advertiser_spend",
  "payout_debit",
  "adjustment",
]);
export const fraudSeverityEnum = pgEnum("fraud_severity", ["info", "warning", "critical"]);
export const impressionStatusEnum = pgEnum("impression_status", [
  "verified",
  "rejected",
  "flagged",
]);

/* --------------------------------- tables --------------------------------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),
    country: text("country"),
    signupIp: text("signup_ip"),
    signupAsn: integer("signup_asn"),
    welcomeBonusCredited: boolean("welcome_bonus_credited").notNull().default(false),
    trustScore: integer("trust_score"),
    isFrozen: boolean("is_frozen").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uidx").on(t.email)],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fingerprintHash: text("fingerprint_hash").notNull(),
    userAgent: text("user_agent"),
    extensionVersion: text("extension_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("devices_user_fp_uidx").on(t.userId, t.fingerprintHash)],
);

/** Refresh-token sessions for the extension and web. */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

/**
 * Geo-diversity signal for fraud scoring. Each row records a distinct
 * (geo cluster, ASN, day) a user authenticated from — the raw IP is hashed
 * for equality checks and never stored in plaintext.
 */
export const userNetworkEvents = pgTable(
  "user_network_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash").notNull(),
    geoCluster: text("geo_cluster").notNull(),
    asn: integer("asn"),
    seenOn: text("seen_on").notNull(), // YYYY-MM-DD
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_network_events_dedup").on(t.userId, t.ipHash, t.seenOn),
    index("user_network_events_user_idx").on(t.userId, t.createdAt),
  ],
);

export const advertisers = pgTable(
  "advertisers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    companyName: text("company_name").notNull(),
    website: text("website"),
    balanceMicro: bigint("balance_micro", { mode: "bigint" }).notNull().default(0n),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("advertisers_email_uidx").on(t.email)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertisers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: campaignStatusEnum("status").notNull().default("draft"),
    headline: text("headline").notNull(),
    bodyText: text("body_text").notNull(),
    ctaText: text("cta_text").notNull(),
    targetUrl: text("target_url").notNull(),
    dailyBudgetMicro: bigint("daily_budget_micro", { mode: "bigint" }).notNull(),
    /** Bid per verified 5s view, micro-dollars. */
    cpiMicro: bigint("cpi_micro", { mode: "bigint" }).notNull(),
    targetPlatforms: jsonb("target_platforms").$type<string[]>().notNull().default([]),
    /** Geo clusters to serve in (e.g. ["NA-EAST","EU-WEST"]); empty = worldwide. */
    targetGeoClusters: jsonb("target_geo_clusters").$type<string[]>().notNull().default([]),
    /** Laya auto-moderation outcome, recorded at creation. */
    moderationDecision: moderationDecisionEnum("moderation_decision"),
    moderationScore: integer("moderation_score"),
    moderationReasons: jsonb("moderation_reasons").$type<string[]>().notNull().default([]),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    maxPerDayPerUser: integer("max_per_day_per_user").notNull().default(3),
    cooldownSec: integer("cooldown_sec").notNull().default(1800),
    spentTodayMicro: bigint("spent_today_micro", { mode: "bigint" }).notNull().default(0n),
    spentTotalMicro: bigint("spent_total_micro", { mode: "bigint" }).notNull().default(0n),
    spendDate: text("spend_date").notNull().default(""), // YYYY-MM-DD of spentTodayMicro
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaigns_status_idx").on(t.status)],
);

/**
 * One lease per (user, campaign, issue) — single-use, consumed when a
 * telemetry event bearing its token is accepted.
 */
export const adLeases = pgTable(
  "ad_leases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedImpressionId: uuid("consumed_impression_id"),
  },
  (t) => [
    index("ad_leases_user_idx").on(t.userId),
    index("ad_leases_expiry_idx").on(t.expiresAt),
  ],
);

export const telemetryBatches = pgTable(
  "telemetry_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    extensionVersion: text("extension_version"),
    eventCount: integer("event_count").notNull(),
    acceptedCount: integer("accepted_count").notNull(),
    flaggedCount: integer("flagged_count").notNull().default(0),
    /** Serialized cadence-analysis findings for audit. */
    cadenceFindings: jsonb("cadence_findings").$type<string[]>().notNull().default([]),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("telemetry_batches_user_idx").on(t.userId, t.receivedAt)],
);

export const impressions = pgTable(
  "impressions",
  {
    id: uuid("id").primaryKey(), // client-generated UUIDv4, idempotency key
    batchId: uuid("batch_id")
      .notNull()
      .references(() => telemetryBatches.id, { onDelete: "cascade" }),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => adLeases.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    placement: text("placement").notNull(),
    displayMode: text("display_mode").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    aiWaitDurationMs: integer("ai_wait_duration_ms").notNull(),
    cumulativeVisibleMs: integer("cumulative_visible_ms").notNull(),
    hoverMs: integer("hover_ms").notNull().default(0),
    hoverIntentional: boolean("hover_intentional").notNull().default(false),
    /** Coarse geo cluster resolved server-side from the client IP. Never a raw IP. */
    geoCluster: text("geo_cluster"),
    earned: boolean("earned").notNull(),
    earnedMicro: bigint("earned_micro", { mode: "bigint" }).notNull().default(0n),
    status: impressionStatusEnum("status").notNull(),
    rejectionReasons: jsonb("rejection_reasons").$type<string[]>().notNull().default([]),
    pohi: jsonb("pohi").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("impressions_user_idx").on(t.userId, t.createdAt),
    index("impressions_campaign_idx").on(t.campaignId, t.createdAt),
  ],
);

/**
 * Double-entry ledger. Every credit has a matching debit. Amounts in
 * micro-dollars; positive = credit to `account`, negative = debit.
 * Account naming: "user:{id}", "advertiser:{id}", "platform:revenue",
 * "platform:promo_liability".
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryType: ledgerEntryTypeEnum("entry_type").notNull(),
    account: text("account").notNull(),
    amountMicro: bigint("amount_micro", { mode: "bigint" }).notNull(),
    referenceType: text("reference_type"), // "impression" | "payout" | "social_task" | ...
    referenceId: uuid("reference_id"),
    memo: text("memo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_account_idx").on(t.account, t.createdAt),
    index("ledger_reference_idx").on(t.referenceType, t.referenceId),
  ],
);

export const socialTasks = pgTable(
  "social_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskType: taskPlatformEnum("task_type").notNull(),
    postUrl: text("post_url").notNull(),
    screenshotKey: text("screenshot_key").notNull(),
    status: taskStatusEnum("status").notNull().default("pending"),
    rewardMicro: bigint("reward_micro", { mode: "bigint" }).notNull().default(100_000n),
    /** Laya auto-moderation outcome for the submitted proof. */
    moderationDecision: moderationDecisionEnum("moderation_decision"),
    moderationScore: integer("moderation_score"),
    moderationReasons: jsonb("moderation_reasons").$type<string[]>().notNull().default([]),
    reviewerNotes: text("reviewer_notes"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("social_tasks_user_idx").on(t.userId, t.createdAt)],
);

export const payoutDestinations = pgTable(
  "payout_destinations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    method: payoutMethodEnum("method").notNull(),
    /** Normalized (lowercased / canonical) destination address or email. */
    addressNormalized: text("address_normalized").notNull(),
    addressDisplay: text("address_display").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payout_dest_user_uidx").on(t.userId, t.method, t.addressNormalized),
    index("payout_dest_address_idx").on(t.addressNormalized),
  ],
);

export const payoutRequests = pgTable(
  "payout_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => payoutDestinations.id, { onDelete: "restrict" }),
    amountMicro: bigint("amount_micro", { mode: "bigint" }).notNull(),
    status: payoutStatusEnum("status").notNull().default("requested"),
    trustScoreAtRequest: integer("trust_score_at_request"),
    trustBreakdown: jsonb("trust_breakdown"),
    processorReference: text("processor_reference"),
    failureReason: text("failure_reason"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("payout_requests_user_idx").on(t.userId, t.requestedAt)],
);

export const fraudLogs = pgTable(
  "fraud_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    severity: fraudSeverityEnum("severity").notNull(),
    rule: text("rule").notNull(), // e.g. "cv_collapse", "lease_replay", "sybil_payout"
    detail: jsonb("detail").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fraud_logs_user_idx").on(t.userId, t.createdAt)],
);

export const clickEvents = pgTable(
  "click_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    impressionId: uuid("impression_id").references(() => impressions.id, {
      onDelete: "set null",
    }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Coarse geo cluster from the click request's IP; raw IP never stored. */
    geoCluster: text("geo_cluster"),
    clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("click_events_campaign_idx").on(t.campaignId, t.clickedAt)],
);

export type User = typeof users.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type AdLease = typeof adLeases.$inferSelect;
export type Impression = typeof impressions.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type SocialTask = typeof socialTasks.$inferSelect;
export type PayoutRequest = typeof payoutRequests.$inferSelect;
export type FraudLog = typeof fraudLogs.$inferSelect;
