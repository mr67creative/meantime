import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { campaigns } from "@meantime/shared/db";
import type { AppContext } from "../context.js";
import { requireAdvertiser } from "../context.js";

export async function advertiserListRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/advertiser/campaigns", async (req, reply) => {
    const auth = requireAdvertiser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.advertiserId) return;
    const rows = await ctx.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.advertiserId, auth.advertiserId))
      .orderBy(desc(campaigns.createdAt))
      .limit(50);
    return rows;
  });
}
