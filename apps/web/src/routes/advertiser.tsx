import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AD_COPY_LIMITS,
  type CampaignAnalytics,
  type CampaignInput,
  type ModerationOutcome,
} from "@meantime/shared";
import { api } from "../lib/api";
import { formatMicroCents, formatMs } from "../lib/format";
import { Shell, PageHeader } from "../lib/shell";
import { Stat, Badge, Empty, Table } from "../lib/ui";

export const Route = createFileRoute("/advertiser")({
  component: AdvertiserPortal,
});

const GEO_CLUSTERS = [
  "NA-EAST", "NA-WEST", "EU-WEST", "EU-CENTRAL", "EU-EAST",
  "APAC-EAST", "APAC-SE", "LATAM", "AF-NORTH",
];

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  headline: string;
  cpiMicro: string;
  spentTotalMicro: string;
  moderationDecision?: string;
}

function AdvertiserPortal() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<CampaignAnalytics | null>(null);
  const [moderation, setModeration] = useState<ModerationOutcome | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [form, setForm] = useState<CampaignInput>({
    name: "",
    headline: "",
    bodyText: "",
    ctaText: "Learn more",
    targetUrl: "",
    dailyBudgetMicro: 5_000_000,
    cpiMicro: 20_000,
    targetPlatforms: ["openai"],
    targetGeoClusters: [],
  });

  async function refresh(): Promise<void> {
    const rows = await api<CampaignRow[]>("/advertiser/campaigns").catch(() => []);
    setCampaigns(rows);
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selected) return;
    api<CampaignAnalytics>(`/advertiser/campaigns/${selected}/analytics`)
      .then(setAnalytics)
      .catch(() => setAnalytics(null));
  }, [selected]);

  async function createCampaign(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setMessage(null);
    setModeration(null);
    try {
      const res = await api<{ campaign: { id: string }; moderation: ModerationOutcome }>(
        "/advertiser/campaigns",
        { method: "POST", json: form },
      );
      setModeration(res.moderation);
      setMessage(
        res.moderation.decision === "auto_approved"
          ? "Approved automatically and now live."
          : res.moderation.decision === "needs_review"
            ? "Sent to a reviewer — you'll be notified."
            : "Rejected by automatic policy checks.",
      );
      await refresh();
      setSelected(res.campaign.id);
    } catch (err) {
      setMessage(String(err));
    }
  }

  function toggleGeo(cluster: string): void {
    setForm((f) => ({
      ...f,
      targetGeoClusters: f.targetGeoClusters.includes(cluster)
        ? f.targetGeoClusters.filter((c) => c !== cluster)
        : [...f.targetGeoClusters, cluster],
    }));
  }

  return (
    <Shell>
      <PageHeader
        title="Advertiser portal"
        description="Text-only micro-campaigns during AI wait time. Bid per verified 5-second human view."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left: create form */}
        <form onSubmit={createCampaign} className="card-pad space-y-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-neutral-900">New campaign</h2>

          <div>
            <label className="label">Campaign name</label>
            <input required value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label">Headline <span className="font-normal text-neutral-400">({form.headline.length}/{AD_COPY_LIMITS.HEADLINE_MAX})</span></label>
            <input required maxLength={AD_COPY_LIMITS.HEADLINE_MAX} value={form.headline}
              onChange={(e) => setForm({ ...form, headline: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label">Body <span className="font-normal text-neutral-400">({form.bodyText.length}/{AD_COPY_LIMITS.BODY_MAX})</span></label>
            <textarea required maxLength={AD_COPY_LIMITS.BODY_MAX} rows={3} value={form.bodyText}
              onChange={(e) => setForm({ ...form, bodyText: e.target.value })} className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">CTA text</label>
              <input required maxLength={AD_COPY_LIMITS.CTA_MAX} value={form.ctaText}
                onChange={(e) => setForm({ ...form, ctaText: e.target.value })} className="input" />
            </div>
            <div>
              <label className="label">Target URL</label>
              <input required type="url" value={form.targetUrl}
                onChange={(e) => setForm({ ...form, targetUrl: e.target.value })} className="input" />
            </div>
          </div>

          <div>
            <label className="label">Geo targeting <span className="font-normal text-neutral-400">(empty = worldwide)</span></label>
            <div className="flex flex-wrap gap-1.5">
              {GEO_CLUSTERS.map((cluster) => {
                const on = form.targetGeoClusters.includes(cluster);
                return (
                  <button type="button" key={cluster} onClick={() => toggleGeo(cluster)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600 hover:border-neutral-400"
                    }`}>
                    {cluster}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Daily budget ($)</label>
              <input required type="number" min={1} step="0.01" value={form.dailyBudgetMicro / 1_000_000}
                onChange={(e) => setForm({ ...form, dailyBudgetMicro: Math.round(Number(e.target.value) * 1_000_000) })}
                className="input" />
            </div>
            <div>
              <label className="label">Bid per 5s view ($)</label>
              <input required type="number" min={0.001} step="0.001" value={form.cpiMicro / 1_000_000}
                onChange={(e) => setForm({ ...form, cpiMicro: Math.round(Number(e.target.value) * 1_000_000) })}
                className="input" />
            </div>
          </div>

          <button type="submit" className="btn-primary w-full">Create campaign</button>

          {moderation && (
            <div className={`rounded-lg border p-3 text-sm ${
              moderation.decision === "auto_approved" ? "border-accent/30 bg-accent-soft text-accent"
              : moderation.decision === "needs_review" ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-red-300 bg-red-50 text-red-700"
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {moderation.decision === "auto_approved" ? "Auto-approved by Laya"
                  : moderation.decision === "needs_review" ? "Sent to review by Laya"
                  : "Auto-rejected by Laya"}
                </span>
                <span className="tabular text-xs">score {moderation.score}</span>
              </div>
              {moderation.reasons.length > 0 && (
                <p className="mt-1 text-xs opacity-80">{moderation.reasons.join(", ")}</p>
              )}
            </div>
          )}
          {message && !moderation && <p className="text-sm text-neutral-500">{message}</p>}
        </form>

        {/* Right: campaign list + analytics */}
        <div className="space-y-6 lg:col-span-3">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">Campaigns</h2>
            <Table head={["Name", "Status", "Moderation", "Spend"]}>
              {campaigns.map((c) => (
                <tr key={c.id} onClick={() => setSelected(c.id)}
                  className={`cursor-pointer ${selected === c.id ? "bg-neutral-50" : "hover:bg-neutral-50"}`}>
                  <td className="px-4 py-3 font-medium text-neutral-900">{c.name}</td>
                  <td className="px-4 py-3 capitalize">{c.status}</td>
                  <td className="px-4 py-3">
                    {c.moderationDecision && (
                      <Badge tone={
                        c.moderationDecision === "auto_approved" ? "good"
                        : c.moderationDecision === "needs_review" ? "warn" : "bad"
                      }>
                        {c.moderationDecision.replace("_", " ")}
                      </Badge>
                    )}
                  </td>
                  <td className="tabular px-4 py-3">{formatMicroCents(Number(c.spentTotalMicro))}</td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr><td colSpan={4}><Empty title="No campaigns yet" hint="Create your first on the left." /></td></tr>
              )}
            </Table>
          </section>

          {analytics && (
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-neutral-900">Analytics</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Views" value={String(analytics.totals.views)} />
                <Stat label="Verified 5s views" value={String(analytics.totals.verifiedViews)}
                  hint={`${(analytics.totals.completionRate * 100).toFixed(0)}% completion`} />
                <Stat label="Intentional hovers" value={String(analytics.totals.intentionalHovers)} />
                <Stat label="Clicks" value={String(analytics.totals.clicks)}
                  hint={`${(analytics.totals.ctr * 100).toFixed(2)}% CTR`} />
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  By geography
                </h3>
                <Table head={["Cluster", "Unique users", "Views", "Verified", "Hovers", "Clicks", "Avg retention"]}>
                  {analytics.geo.map((g) => (
                    <tr key={g.geoCluster}>
                      <td className="px-4 py-3 font-medium text-neutral-900">{g.geoCluster}</td>
                      <td className="tabular px-4 py-3">{g.uniqueUsers}</td>
                      <td className="tabular px-4 py-3">{g.views}</td>
                      <td className="tabular px-4 py-3">{g.verifiedViews}</td>
                      <td className="tabular px-4 py-3">{g.intentionalHovers}</td>
                      <td className="tabular px-4 py-3">{g.clicks}</td>
                      <td className="tabular px-4 py-3">{formatMs(g.avgRetentionMs)}</td>
                    </tr>
                  ))}
                  {analytics.geo.length === 0 && (
                    <tr><td colSpan={7}><Empty title="No geo data yet" /></td></tr>
                  )}
                </Table>
              </div>
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}
