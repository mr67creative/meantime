import { CADENCE, PACING, type ImpressionEvent } from "@meantime/shared";

/**
 * Layer 3 — Temporal entropy & cadence analysis, plus Layer 4 velocity
 * dampening. Pure functions; the caller supplies windowed history.
 */

export interface CadenceFinding {
  rule: string;
  severity: "info" | "warning" | "critical";
  detail: Record<string, unknown>;
}

/** Coefficient of variation: σ/μ of inter-prompt intervals. */
export function coefficientOfVariation(intervalsMs: number[]): {
  mean: number;
  stddev: number;
  cv: number;
} {
  if (intervalsMs.length < 2) return { mean: 0, stddev: 0, cv: 1 };
  const mean = intervalsMs.reduce((a, b) => a + b, 0) / intervalsMs.length;
  if (mean === 0) return { mean: 0, stddev: 0, cv: 0 };
  const variance =
    intervalsMs.reduce((acc, v) => acc + (v - mean) ** 2, 0) / intervalsMs.length;
  const stddev = Math.sqrt(variance);
  return { mean, stddev, cv: stddev / mean };
}

/**
 * Evaluate a batch's events against recent history. Returns findings; an
 * empty array means "no signal". A finding with severity "critical" causes
 * batch-level flagging; "warning" contributes to the trust score.
 */
export function analyzeCadence(
  events: ImpressionEvent[],
  recentSubmittedAts: number[],
  recentVisibleMs: number[],
): CadenceFinding[] {
  const findings: CadenceFinding[] = [];

  // Inter-prompt intervals from merged history + this batch.
  const timestamps = [...recentSubmittedAts, ...events.map((e) => e.submittedAt)].sort(
    (a, b) => a - b,
  );
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push((timestamps[i] as number) - (timestamps[i - 1] as number));
  }

  if (intervals.length >= CADENCE.MIN_SAMPLE) {
    const { mean, stddev, cv } = coefficientOfVariation(intervals);
    if (cv < CADENCE.CV_FLAG_THRESHOLD && mean > 0 && mean < 120_000) {
      findings.push({
        rule: "cv_collapse",
        severity: "critical",
        detail: {
          cv: Number(cv.toFixed(4)),
          meanMs: Math.round(mean),
          stddevMs: Math.round(stddev),
          samples: intervals.length,
        },
      });
    } else if (cv < CADENCE.CV_HUMAN_TYPICAL * 0.5 && mean < 60_000) {
      findings.push({
        rule: "cv_low",
        severity: "warning",
        detail: { cv: Number(cv.toFixed(4)), meanMs: Math.round(mean), samples: intervals.length },
      });
    }
  }

  // Viewport-duration clustering: everything lands in a razor-thin band just
  // above the payout cutoff — the signature of a "wait exactly 5001ms" script.
  const visible = [...recentVisibleMs, ...events.map((e) => e.cumulativeVisibleMs)];
  const streak = trailingClusterStreak(visible);
  if (streak >= CADENCE.CLUSTER_STREAK) {
    findings.push({
      rule: "viewport_duration_cluster",
      severity: "critical",
      detail: { streak, bandMs: [CADENCE.CLUSTER_MIN_MS, CADENCE.CLUSTER_MAX_MS] },
    });
  }

  return findings;
}

function trailingClusterStreak(valuesMs: number[]): number {
  let streak = 0;
  for (let i = valuesMs.length - 1; i >= 0; i--) {
    const v = valuesMs[i] as number;
    if (v >= CADENCE.CLUSTER_MIN_MS && v <= CADENCE.CLUSTER_MAX_MS) streak++;
    else break;
  }
  return streak;
}

/* ------------------------------ pacing (Layer 4) ------------------------- */

export interface PacingDecision {
  tier: 1 | 2 | 3;
  allow: boolean;
  promptDivisor: number;
  remainingThisHour: number;
}

export function pacingFor(promptsLastHour: number): PacingDecision {
  if (promptsLastHour <= PACING.TIER1_MAX_PER_HOUR) {
    return {
      tier: 1,
      allow: true,
      promptDivisor: 1,
      remainingThisHour: PACING.TIER1_MAX_PER_HOUR - promptsLastHour,
    };
  }
  if (promptsLastHour <= PACING.TIER2_MAX_PER_HOUR) {
    return {
      tier: 2,
      allow: promptsLastHour % PACING.TIER2_PROMPT_DIVISOR === 0,
      promptDivisor: PACING.TIER2_PROMPT_DIVISOR,
      remainingThisHour: Math.floor(
        (PACING.TIER2_MAX_PER_HOUR - promptsLastHour) / PACING.TIER2_PROMPT_DIVISOR,
      ),
    };
  }
  return { tier: 3, allow: false, promptDivisor: 1, remainingThisHour: -1 };
}
