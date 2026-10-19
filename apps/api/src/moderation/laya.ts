import { LAYA, type ModerationOutcome, type ModerationDecision } from "@meantime/shared";

/**
 * Laya — an open-source, non-chat AI that runs in Docker. Unlike a chat model
 * it never generates free text back at us; it takes structured input and
 * returns structured judgments (labels + confidence). We run it as a local
 * sidecar container and call it over HTTP.
 *
 * Design contract:
 *  - Laya is the PRIMARY classifier for content quality/policy.
 *  - Deterministic checks run FIRST as a security boundary: anything that's
 *    clearly abusive (blocked terms, malformed URLs) is rejected without
 *    waiting on the model, and a Laya outage never auto-approves content —
 *    it falls back to "needs_review", never to "approved".
 */

export interface LayaConfig {
  /** Base URL of the Laya sidecar, e.g. http://localhost:8080 */
  endpoint: string;
  /** Request timeout; a slow Laya must not stall the API. */
  timeoutMs: number;
  enabled: boolean;
}

export const DEFAULT_LAYA: LayaConfig = {
  endpoint: process.env.LAYA_ENDPOINT ?? "http://localhost:8080",
  timeoutMs: 4_000,
  enabled: (process.env.LAYA_ENABLED ?? "true") === "true",
};

/* ---------------------------- Laya HTTP client --------------------------- */

interface LayaScoreRequest {
  task: "ad_copy" | "proof_image";
  text?: string;
  url?: string;
  imageKey?: string;
}

interface LayaScoreResponse {
  score: number; // 0..100
  labels: string[]; // e.g. ["spam", "misleading"]
  confidence: number; // 0..1
}

async function layaClassify(
  cfg: LayaConfig,
  req: LayaScoreRequest,
): Promise<LayaScoreResponse | null> {
  if (!cfg.enabled) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.endpoint}/v1/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as LayaScoreResponse;
    if (typeof body.score !== "number" || !Array.isArray(body.labels)) return null;
    return body;
  } catch {
    return null; // timeout / unreachable — caller falls back safely
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------- deterministic policy ------------------------- */
/* These run first and are authoritative for clear-cut abuse. */

const BLOCKED_TERMS = [
  "make money fast",
  "crypto doubling",
  "free robux",
  "loan shark",
];

const SUSPICIOUS_TLDS = [".xyz", ".top", ".click", ".loan", ".win"];

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

interface PolicyResult {
  /** true when content is clearly abusive — reject without consulting Laya. */
  hardReject: boolean;
  reasons: string[];
}

function policyScan(text: string, url: string): PolicyResult {
  const reasons: string[] = [];
  let hardReject = false;
  const lower = text.toLowerCase();

  for (const term of BLOCKED_TERMS) {
    if (lower.includes(term)) {
      hardReject = true;
      reasons.push(`blocked_term:${term}`);
    }
  }
  const host = safeHost(url);
  if (!host) {
    hardReject = true;
    reasons.push("invalid_url");
  } else if (SUSPICIOUS_TLDS.some((tld) => host.endsWith(tld))) {
    reasons.push("suspicious_tld"); // not a hard reject — Laya decides
  }
  if (/(.)\1{5,}/.test(lower)) reasons.push("character_repetition");
  return { hardReject, reasons };
}

/* ------------------------------- decisions ------------------------------- */

function decide(score: number, approveAt: number): ModerationDecision {
  if (score >= approveAt) return "auto_approved";
  if (score < LAYA.AUTO_REJECT) return "auto_rejected";
  return "needs_review";
}

export interface LayaCampaignInput {
  headline: string;
  bodyText: string;
  ctaText: string;
  targetUrl: string;
  advertiserAgeDays: number;
  advertiserRejectedCount: number;
  advertiserApprovedCount: number;
}

export interface LayaTaskInput {
  postUrl: string;
  taskType: string;
  screenshotKey: string;
  accountAgeDays: number;
}

/**
 * Campaign moderation. Laya classifies the ad copy; reputation nudges the
 * score; clear-cut abuse is rejected before the model is ever consulted.
 */
export async function moderateCampaign(
  input: LayaCampaignInput,
  cfg: LayaConfig = DEFAULT_LAYA,
): Promise<ModerationOutcome> {
  const policy = policyScan(`${input.headline} ${input.bodyText} ${input.ctaText}`, input.targetUrl);
  if (policy.hardReject) {
    return { score: 0, decision: "auto_rejected", reasons: policy.reasons, layers: ["policy"] };
  }

  const layers = ["policy"];
  const reasons = [...policy.reasons];

  // Laya is the primary content judge.
  const laya = await layaClassify(cfg, {
    task: "ad_copy",
    text: `${input.headline}\n${input.bodyText}\n${input.ctaText}`,
    url: input.targetUrl,
  });

  if (laya === null) {
    // Laya unavailable: never auto-approve on an outage — route to a human.
    layers.push("laya_unavailable");
    return {
      score: 50,
      decision: "needs_review",
      reasons: [...reasons, "laya_unavailable"],
      layers,
    };
  }

  layers.push("laya");
  reasons.push(...laya.labels.map((l) => `laya:${l}`));
  let score = laya.score;

  // Reputation adjusts at the margins only — it cannot rescue bad content.
  if (input.advertiserRejectedCount > 0) {
    score -= Math.min(20, input.advertiserRejectedCount * 8);
    reasons.push("prior_rejections");
  }
  if (input.advertiserAgeDays < 1) {
    score -= 5;
    reasons.push("new_advertiser");
  }
  if (input.advertiserApprovedCount >= 10 && score >= LAYA.AUTO_APPROVE - 5) {
    score = Math.min(100, score + 3);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, decision: decide(score, LAYA.AUTO_APPROVE), reasons, layers };
}

/**
 * Task-proof moderation. Laya checks that the uploaded screenshot actually
 * shows the claimed platform/action (non-chat image classification).
 */
export async function moderateTask(
  input: LayaTaskInput,
  cfg: LayaConfig = DEFAULT_LAYA,
): Promise<ModerationOutcome> {
  const reasons: string[] = [];
  const layers = ["policy"];

  if (!/^https?:\/\//.test(input.postUrl)) {
    return {
      score: 0,
      decision: "auto_rejected",
      reasons: ["invalid_post_url"],
      layers,
    };
  }

  const laya = await layaClassify(cfg, {
    task: "proof_image",
    url: input.postUrl,
    imageKey: input.screenshotKey,
  });

  if (laya === null) {
    layers.push("laya_unavailable");
    return {
      score: 50,
      decision: "needs_review",
      reasons: [...reasons, "laya_unavailable"],
      layers,
    };
  }

  layers.push("laya");
  reasons.push(...laya.labels.map((l) => `laya:${l}`));
  let score = laya.score;
  if (input.accountAgeDays < 1) {
    score -= 10;
    reasons.push("new_account");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  // Social tasks pay cash, so the auto-approve bar is stricter.
  return { score, decision: decide(score, LAYA.TASK_AUTO_APPROVE), reasons, layers };
}
