/** Monetary amounts are stored as micro-dollars: $1.00 = 1_000_000. */
export const MICRO_DOLLARS_PER_USD = 1_000_000;

export const REVENUE_SHARE = {
  USER_BPS: 5_500,
  PLATFORM_BPS: 4_500,
} as const;

export const PAYOUT_THRESHOLD_USD = 5_000_000; // $5.00 in micro-dollars
export const WELCOME_BONUS_USD = 1_000_000; // $1.00
export const SOCIAL_TASK_REWARD_USD = 100_000; // $0.10

/** Cumulative active-viewport time required for an impression to be paid. */
export const MIN_VIEWABLE_MS = 5_000;
/** Fraction of the ad element that must be visible to accrue time. */
export const VIEWABILITY_THRESHOLD = 0.75;

export const EXTENSION_CACHE = {
  MAX_CACHED_ADS: 25,
  LOW_WATER_MARK: 5,
  PREFETCH_BATCH_SIZE: 15,
} as const;

export const TELEMETRY = {
  FLUSH_INTERVAL_MINUTES: 15,
  FLUSH_QUEUE_SIZE: 15,
  MAX_EVENTS_PER_BATCH: 50,
  /** Compression stats (algorithms can also declare their own ranges). */
  DEFLATE_FORMAT: "deflate",
} as const;

/** Pacing tiers for Layer-4 velocity dampening. */
export const PACING = {
  WINDOW_SECONDS: 3_600,
  TIER1_MAX_PER_HOUR: 12,
  TIER2_MAX_PER_HOUR: 25,
  /** In tier 2, one ad is shown every N prompts. */
  TIER2_PROMPT_DIVISOR: 3,
} as const;

/** Layer-3 cadence analysis thresholds. */
export const CADENCE = {
  /** Minimum prompts in a sliding window before CV is evaluated. */
  MIN_SAMPLE: 15,
  /** Batches with coefficient of variation below this are flagged. */
  CV_FLAG_THRESHOLD: 0.08,
  /** Humans typically sit well above this; informational. */
  CV_HUMAN_TYPICAL: 0.35,
  /** Impressions with viewable-ms in [5001, 5015]... */
  CLUSTER_MIN_MS: 5_001,
  CLUSTER_MAX_MS: 5_015,
  /** ...across this many consecutive impressions triggers a flag. */
  CLUSTER_STREAK: 50,
} as const;

/** Layer-5 composite trust score bands. */
export const TRUST = {
  AUTO_APPROVE: 80,
  MANUAL_REVIEW: 50,
} as const;

export const AD_COPY_LIMITS = {
  HEADLINE_MAX: 70,
  BODY_MAX: 140,
  CTA_MAX: 24,
} as const;

export const LEASE = {
  TTL_SECONDS: 43_200, // 12 hours
  CLOCK_SKEW_SECONDS: 120,
} as const;

export const SNOOZE_OPTIONS_MINUTES = [10, 15, 60] as const;

export const PLATFORM_IDS = [
  "openai",
  "gemini",
  "grok",
  "claude",
  "deepseek",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];
