import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  PAYOUT_THRESHOLD_USD,
  SOCIAL_TASK_REWARD_USD,
  campaignInputSchema,
  payoutRequestSchema,
  taskSubmissionSchema,
  type CampaignStats,
  type TaskSubmission,
  type TransparencyLogEntry,
  type UserBalance,
} from "@meantime/shared";
import {
  campaigns,
  clickEvents,
  impressions,
  payoutDestinations,
  payoutRequests,
  socialTasks,
  users,
} from "@meantime/shared/db";
import type { AppContext } from "../context.js";
import { requireAdvertiser, requireUser } from "../context.js";
import { ACCOUNTS, balanceOf, postTransfer } from "../ledger.js";
import { computeTrustScore, verdictFor, logFraud } from "../fraud/trust.js";

function s3(ctx: AppContext): S3Client {
  return new S3Client({
    endpoint: ctx.env.S3_ENDPOINT,
    region: ctx.env.S3_REGION,
    credentials: { accessKeyId: ctx.env.S3_ACCESS_KEY, secretAccessKey: ctx.env.S3_SECRET_KEY },
    forcePathStyle: true,
  });
}

export async function userRoutes(app: FastifyInstance, ctx: AppContext) {
  /* ------------------------------ balance ------------------------------- */
  app.get("/me/balance", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const [available, pending, platformRevenue] = await Promise.all([
      balanceOf(ctx.db, ACCOUNTS.user(auth.userId)),
      balanceOf(ctx.db, ACCOUNTS.userPending(auth.userId)),
      balanceOf(ctx.db, ACCOUNTS.platformRevenue),
    ]);
    void platformRevenue;
    const balance: UserBalance = {
      availableMicro: Number(available),
      pendingMicro: Number(pending),
      lifetimeMicro: Number(available + pending),
      thresholdMicro: PAYOUT_THRESHOLD_USD,
    };
    return balance;
  });

  /* -------------------------- transparency log -------------------------- */
  app.get("/me/impressions", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const rows = await ctx.db
      .select({
        impressionId: impressions.id,
        submittedAt: impressions.submittedAt,
        platform: impressions.platform,
        cumulativeVisibleMs: impressions.cumulativeVisibleMs,
        earned: impressions.earned,
        earnedMicro: impressions.earnedMicro,
        headline: campaigns.headline,
      })
      .from(impressions)
      .leftJoin(campaigns, eq(impressions.campaignId, campaigns.id))
      .where(eq(impressions.userId, auth.userId))
      .orderBy(desc(impressions.createdAt))
      .limit(100);
    const log: TransparencyLogEntry[] = rows.map((r) => ({
      impressionId: r.impressionId,
      viewedAt: r.submittedAt.getTime(),
      platform: r.platform,
      cumulativeVisibleMs: r.cumulativeVisibleMs,
      eligible: r.earned,
      earnedMicro: Number(r.earnedMicro),
      campaignHeadline: r.headline ?? "",
    }));
    return log;
  });

  /* ------------------------------ social tasks -------------------------- */
  app.post("/tasks/presign", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const { contentType } = req.body as { contentType?: string };
    const key = `task-proofs/${auth.userId}/${crypto.randomUUID()}`;
    const url = await getSignedUrl(
      s3(ctx),
      new PutObjectCommand({
        Bucket: ctx.env.S3_BUCKET,
        Key: key,
        ContentType: contentType ?? "image/png",
      }),
      { expiresIn: 900 },
    );
    return { uploadUrl: url, key };
  });

  app.post("/tasks/submit", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const body = taskSubmissionSchema.parse(req.body);
    const { screenshotKey } = req.body as { screenshotKey?: string };
    if (!screenshotKey) return reply.code(400).send({ error: "screenshot_required" });

    const [task] = await ctx.db
      .insert(socialTasks)
      .values({
        userId: auth.userId,
        taskType: body.taskType,
        postUrl: body.postUrl,
        screenshotKey,
        rewardMicro: BigInt(SOCIAL_TASK_REWARD_USD),
      })
      .returning();
    return { taskId: task?.id, status: task?.status };
  });

  app.get("/tasks/mine", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const rows = await ctx.db
      .select()
      .from(socialTasks)
      .where(eq(socialTasks.userId, auth.userId))
      .orderBy(desc(socialTasks.createdAt))
      .limit(50);
    return rows;
  });

  /* ------------------------------- payouts ------------------------------ */
  app.post("/payouts/request", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const userId = auth.userId;
    const body = payoutRequestSchema.parse(req.body);

    const available = await balanceOf(ctx.db, ACCOUNTS.user(userId));
    if (available < BigInt(PAYOUT_THRESHOLD_USD)) {
      return reply.code(400).send({ error: "below_threshold", thresholdMicro: PAYOUT_THRESHOLD_USD });
    }
    if (BigInt(body.amountMicro) > available) {
      return reply.code(400).send({ error: "insufficient_balance" });
    }

    const [user] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (user?.isFrozen) return reply.code(403).send({ error: "account_frozen" });

    const addressNormalized = body.address.trim().toLowerCase();

    // Layer 5: one payout address = one account.
    const conflict = await ctx.db
      .select({ userId: payoutDestinations.userId })
      .from(payoutDestinations)
      .where(and(eq(payoutDestinations.addressNormalized, addressNormalized), sql`${payoutDestinations.userId} <> ${userId}`))
      .limit(1);
    if (conflict.length > 0) {
      await logFraud(ctx.db, {
        userId,
        severity: "critical",
        rule: "sybil_payout_address",
        detail: { addressNormalized },
      });
      return reply.code(409).send({ error: "address_in_use" });
    }

    const [dest] = await ctx.db
      .insert(payoutDestinations)
      .values({ userId, method: body.method, addressNormalized, addressDisplay: body.address })
      .onConflictDoNothing()
      .returning();
    const destinationId = dest?.id ?? (
      await ctx.db
        .select()
        .from(payoutDestinations)
        .where(and(eq(payoutDestinations.userId, userId), eq(payoutDestinations.addressNormalized, addressNormalized)))
        .limit(1)
    )[0]?.id;
    if (!destinationId) return reply.code(500).send({ error: "destination_failed" });

    const trust = await computeTrustScore(ctx.db, userId);
    const verdict = verdictFor(trust.total);

    const status =
      verdict === "auto_approve" ? "approved" : verdict === "manual_review" ? "auditing" : "frozen";

    const [request] = await ctx.db
      .insert(payoutRequests)
      .values({
        userId,
        destinationId,
        amountMicro: BigInt(body.amountMicro),
        status,
        trustScoreAtRequest: trust.total,
        trustBreakdown: trust as unknown as Record<string, unknown>,
      })
      .returning();
    if (!request) return reply.code(500).send({ error: "request_failed" });

    if (status !== "frozen") {
      await ctx.db.transaction(async (tx) => {
        await postTransfer(tx, {
          entryType: "payout_debit",
          from: ACCOUNTS.user(userId),
          to: ACCOUNTS.platformFloat,
          amountMicro: BigInt(body.amountMicro),
          referenceType: "payout",
          referenceId: request.id,
        });
        // Unlock the pending welcome bonus once the user has crossed the threshold.
        const pending = await balanceOf(ctx.db, ACCOUNTS.userPending(userId));
        if (pending > 0n) {
          await postTransfer(tx, {
            entryType: "welcome_bonus",
            from: ACCOUNTS.userPending(userId),
            to: ACCOUNTS.user(userId),
            amountMicro: pending,
            referenceType: "payout",
            referenceId: request.id,
            memo: "Welcome bonus unlocked at withdrawal threshold",
          });
        }
      });
    } else {
      await logFraud(ctx.db, {
        userId,
        severity: "critical",
        rule: "payout_frozen_low_trust",
        detail: trust as unknown as Record<string, unknown>,
      });
    }

    return { payoutId: request.id, status: request.status, trustScore: trust.total };
  });
}

export async function advertiserRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/advertiser/campaigns", async (req, reply) => {
    const auth = requireAdvertiser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.advertiserId) return;
    const body = campaignInputSchema.parse(req.body);
    const [campaign] = await ctx.db
      .insert(campaigns)
      .values({
        advertiserId: auth.advertiserId,
        name: body.name,
        status: "draft",
        headline: body.headline,
        bodyText: body.bodyText,
        ctaText: body.ctaText,
        targetUrl: body.targetUrl,
        dailyBudgetMicro: BigInt(body.dailyBudgetMicro),
        cpiMicro: BigInt(body.cpiMicro),
        targetPlatforms: body.targetPlatforms,
        maxPerDayPerUser: body.maxPerDayPerUser,
        cooldownSec: body.cooldownSec,
      })
      .returning();
    return campaign;
  });

  app.post("/advertiser/campaigns/:id/activate", async (req, reply) => {
    const auth = requireAdvertiser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.advertiserId) return;
    const { id } = req.params as { id: string };
    const [campaign] = await ctx.db
      .update(campaigns)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(campaigns.id, id), eq(campaigns.advertiserId, auth.advertiserId)))
      .returning();
    return campaign;
  });

  app.get("/advertiser/campaigns/:id/stats", async (req, reply) => {
    const auth = requireAdvertiser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.advertiserId) return;
    const { id } = req.params as { id: string };

    const [campaign] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    if (!campaign || campaign.advertiserId !== auth.advertiserId) {
      return reply.code(404).send({ error: "not_found" });
    }

    const [agg] = await ctx.db
      .select({
        impressions: sql<number>`count(*)`,
        verifiedViews: sql<number>`count(*) filter (where ${impressions.earned})`,
        avgVisibleMs: sql<number>`coalesce(avg(${impressions.cumulativeVisibleMs}), 0)`,
      })
      .from(impressions)
      .where(eq(impressions.campaignId, id));
    const [clicks] = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(clickEvents)
      .where(eq(clickEvents.campaignId, id));

    const impressionCount = Number(agg?.impressions ?? 0);
    const verifiedViews = Number(agg?.verifiedViews ?? 0);
    const clickCount = Number(clicks?.count ?? 0);

    const stats: CampaignStats = {
      campaignId: id,
      impressions: impressionCount,
      verifiedViews,
      completionRate: impressionCount > 0 ? verifiedViews / impressionCount : 0,
      clicks: clickCount,
      ctr: impressionCount > 0 ? clickCount / impressionCount : 0,
      spendMicro: Number(campaign.spentTotalMicro),
      avgVisibleMs: Math.round(Number(agg?.avgVisibleMs ?? 0)),
    };
    return stats;
  });

  app.post("/ads/click", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;
    const { impressionId, leaseToken } = req.body as { impressionId?: string; leaseToken?: string };
    if (!impressionId || !leaseToken) return reply.code(400).send({ error: "invalid" });
    const dot = leaseToken.lastIndexOf(".");
    let campaignId = "";
    try {
      const payload = JSON.parse(Buffer.from(leaseToken.slice(0, dot), "base64url").toString()) as { cid?: string };
      campaignId = payload.cid ?? "";
    } catch {
      return reply.code(400).send({ error: "invalid" });
    }
    if (!campaignId) return reply.code(400).send({ error: "invalid" });
    await ctx.db.insert(clickEvents).values({ impressionId, campaignId, userId: auth.userId });
    return { ok: true };
  });
}
