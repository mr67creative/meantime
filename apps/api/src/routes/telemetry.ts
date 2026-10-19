import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  MIN_VIEWABLE_MS,
  REVENUE_SHARE,
  telemetryBatchSchema,
  verifyLeaseToken,
  type ImpressionEvent,
  type TelemetryBatchResponse,
  type TelemetryEventResult,
} from "@meantime/shared";
import { adLeases, campaigns, impressions, telemetryBatches, users } from "@meantime/shared/db";
import type { AppContext } from "../context.js";
import { requireUser } from "../context.js";
import { ACCOUNTS, postTransfer } from "../ledger.js";
import { analyzeCadence, type CadenceFinding } from "../fraud/cadence.js";
import { logFraud } from "../fraud/trust.js";

export async function telemetryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/telemetry/batch", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const userId = auth.userId;

    const batch = telemetryBatchSchema.parse(req.body);

    // Pull the last hour of history for cadence analysis.
    const hourAgo = new Date(Date.now() - 3600_000);
    const recent = await ctx.db
      .select({
        submittedAt: impressions.submittedAt,
        cumulativeVisibleMs: impressions.cumulativeVisibleMs,
      })
      .from(impressions)
      .where(and(eq(impressions.userId, userId), gte(impressions.createdAt, hourAgo)))
      .orderBy(desc(impressions.createdAt))
      .limit(200);

    const findings: CadenceFinding[] = analyzeCadence(
      batch.events as ImpressionEvent[],
      recent.map((r) => r.submittedAt.getTime()),
      recent.map((r) => r.cumulativeVisibleMs),
    );
    const criticalFindings = findings.filter((f) => f.severity === "critical");

    const [batchRow] = await ctx.db
      .insert(telemetryBatches)
      .values({
        userId,
        deviceId: auth.deviceId ?? null,
        extensionVersion: batch.extensionVersion,
        eventCount: batch.events.length,
        acceptedCount: 0,
        cadenceFindings: findings.map((f) => f.rule),
      })
      .returning();
    if (!batchRow) return reply.code(500).send({ error: "batch_failed" });

    const results: TelemetryEventResult[] = [];
    let accepted = 0;
    let flagged = 0;

    for (const event of batch.events) {
      const result = await processEvent(ctx, userId, batchRow.id, event, criticalFindings);
      results.push(result);
      if (result.status === "verified") accepted++;
      if (result.status === "flagged") flagged++;
    }

    await ctx.db
      .update(telemetryBatches)
      .set({ acceptedCount: accepted, flaggedCount: flagged })
      .where(eq(telemetryBatches.id, batchRow.id));

    for (const f of findings) {
      await logFraud(ctx.db, {
        userId,
        severity: f.severity,
        rule: f.rule,
        detail: f.detail,
      });
    }

    const response: TelemetryBatchResponse = { accepted, results };
    return response;
  });
}

async function processEvent(
  ctx: AppContext,
  userId: string,
  batchId: string,
  event: ImpressionEvent,
  batchCriticalFindings: CadenceFinding[],
): Promise<TelemetryEventResult> {
  const reasons: string[] = [];

  /* ---- Layer 1: cryptographic lease validation ---- */
  const verification = await verifyLeaseToken(
    event.leaseToken,
    ctx.env.LEASE_HMAC_SECRET,
    Math.floor(Date.now() / 1000),
  );
  if (!verification.ok || !verification.payload) {
    reasons.push(`lease_${verification.reason ?? "invalid"}`);
    await persist(ctx, batchId, userId, event, "rejected", reasons, 0n, null);
    return { impressionId: event.impressionId, status: "rejected", earnedMicro: 0, reasons };
  }
  const lease = verification.payload;
  if (lease.uid !== userId) {
    reasons.push("lease_user_mismatch");
    await persist(ctx, batchId, userId, event, "rejected", reasons, 0n, null);
    return { impressionId: event.impressionId, status: "rejected", earnedMicro: 0, reasons };
  }

  // Single-use enforcement: Redis SETNX, backed by the DB consumedAt column.
  const leaseKey = `lease:consumed:${lease.lid}`;
  const setnx = await ctx.redis
    .set(leaseKey, event.impressionId, "EX", 86400, "NX")
    .catch(() => "OK"); // Redis down: fall through to the DB check below.

  const [leaseRow] = await ctx.db
    .select()
    .from(adLeases)
    .where(eq(adLeases.id, lease.lid))
    .limit(1);

  if (setnx !== "OK" || !leaseRow || leaseRow.consumedAt !== null) {
    reasons.push(setnx !== "OK" ? "lease_replay" : "lease_already_consumed");
    await persist(ctx, batchId, userId, event, "rejected", reasons, 0n, leaseRow?.campaignId ?? null);
    return { impressionId: event.impressionId, status: "rejected", earnedMicro: 0, reasons };
  }

  /* ---- Layer 2: proof of human interaction ---- */
  if (event.pohi.inputInteractionScore < 0.25) reasons.push("no_trusted_input");
  if (!event.pohi.aiMutationVerified) reasons.push("no_ai_mutation");

  /* ---- Threshold & batch-level cadence ---- */
  const viewableEnough = event.cumulativeVisibleMs >= MIN_VIEWABLE_MS;
  if (!viewableEnough) reasons.push("below_threshold");
  if (batchCriticalFindings.length > 0) reasons.push(...batchCriticalFindings.map((f) => f.rule));

  const verified = reasons.length === 0 && viewableEnough;
  const status = verified ? "verified" : batchCriticalFindings.length > 0 ? "flagged" : "rejected";
  const campaignId = leaseRow.campaignId;

  /* ---- Revenue share (55/45) on verified views ---- */
  let earnedMicro = 0n;
  if (verified) {
    const [campaign] = await ctx.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    if (campaign) {
      earnedMicro = (campaign.cpiMicro * BigInt(REVENUE_SHARE.USER_BPS)) / 10_000n;
      const platformMicro = campaign.cpiMicro - earnedMicro;
      const today = new Date().toISOString().slice(0, 10);

      await ctx.db.transaction(async (tx) => {
        await postTransfer(tx, {
          entryType: "advertiser_spend",
          from: ACCOUNTS.advertiser(campaign.advertiserId),
          to: ACCOUNTS.platformFloat,
          amountMicro: campaign.cpiMicro,
          referenceType: "impression",
          referenceId: event.impressionId,
        });
        await postTransfer(tx, {
          entryType: "ad_revenue_share",
          from: ACCOUNTS.platformFloat,
          to: ACCOUNTS.user(userId),
          amountMicro: earnedMicro,
          referenceType: "impression",
          referenceId: event.impressionId,
        });
        await postTransfer(tx, {
          entryType: "ad_revenue_share",
          from: ACCOUNTS.platformFloat,
          to: ACCOUNTS.platformRevenue,
          amountMicro: platformMicro,
          referenceType: "impression",
          referenceId: event.impressionId,
        });
        await tx
          .update(campaigns)
          .set({
            spentTodayMicro:
              campaign.spendDate === today
                ? sql`${campaigns.spentTodayMicro} + ${campaign.cpiMicro}`
                : campaign.cpiMicro,
            spentTotalMicro: sql`${campaigns.spentTotalMicro} + ${campaign.cpiMicro}`,
            spendDate: today,
          })
          .where(eq(campaigns.id, campaign.id));
        await tx
          .update(adLeases)
          .set({ consumedAt: new Date(), consumedImpressionId: event.impressionId })
          .where(eq(adLeases.id, lease.lid));
      });
    }
  } else {
    await ctx.db
      .update(adLeases)
      .set({ consumedAt: new Date(), consumedImpressionId: event.impressionId })
      .where(eq(adLeases.id, lease.lid));
  }

  await persist(ctx, batchId, userId, event, status, reasons, earnedMicro, campaignId);
  return { impressionId: event.impressionId, status, earnedMicro: Number(earnedMicro), reasons };
}

async function persist(
  ctx: AppContext,
  batchId: string,
  userId: string,
  event: ImpressionEvent,
  status: "verified" | "rejected" | "flagged",
  reasons: string[],
  earnedMicro: bigint,
  campaignId: string | null,
): Promise<void> {
  if (!campaignId) return;
  await ctx.db
    .insert(impressions)
    .values({
      id: event.impressionId,
      batchId,
      leaseId: event.leaseToken ? leaseIdFromToken(event.leaseToken) : crypto.randomUUID(),
      userId,
      campaignId,
      platform: event.platform,
      placement: event.placement,
      displayMode: event.displayMode,
      submittedAt: new Date(event.submittedAt),
      aiWaitDurationMs: Math.round(event.aiWaitDurationMs),
      cumulativeVisibleMs: Math.round(event.cumulativeVisibleMs),
      earned: status === "verified",
      earnedMicro,
      status,
      rejectionReasons: reasons,
      pohi: event.pohi,
    })
    .onConflictDoNothing();
}

/** Extract the lease id from a verified token's payload without re-verifying. */
function leaseIdFromToken(token: string): string {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return crypto.randomUUID();
  try {
    const body = JSON.parse(Buffer.from(token.slice(0, dot), "base64url").toString()) as {
      lid?: string;
    };
    return body.lid ?? crypto.randomUUID();
  } catch {
    return crypto.randomUUID();
  }
}
