import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AD_COPY_LIMITS, type CampaignStats, type CampaignInput } from "@meantime/shared";
import { api } from "../lib/api";
import { formatMicroCents, formatMs } from "../lib/format";

export const Route = createFileRoute("/advertiser")({
  component: AdvertiserPortal,
});

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  headline: string;
  cpiMicro: string;
  spentTotalMicro: string;
}

function AdvertiserPortal() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [stats, setStats] = useState<Record<string, CampaignStats>>({});
  const [form, setForm] = useState<CampaignInput>({
    name: "",
    headline: "",
    bodyText: "",
    ctaText: "Learn more",
    targetUrl: "",
    dailyBudgetMicro: 5_000_000,
    cpiMicro: 20_000,
    targetPlatforms: ["openai"],
  });
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    // Placeholder list endpoint — the real portal would page through the
    // advertiser's own campaigns. For now, stats are fetched per campaign id
    // already known to the session.
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createCampaign(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setMessage(null);
    try {
      const created = await api<{ id: string }>("/advertiser/campaigns", {
        method: "POST",
        json: form,
      });
      await api(`/advertiser/campaigns/${created.id}/activate`, { method: "POST" });
      setMessage("Campaign created and activated.");
    } catch (err) {
      setMessage(String(err));
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Advertiser portal</h1>
      <p className="text-neutral-600">
        Text-only micro-campaigns placed during AI wait time. You bid per
        verified 5-second human view — not per impression.
      </p>

      <form onSubmit={createCampaign} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold">New campaign</h2>
        <Field label="Campaign name">
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label={`Headline (max ${AD_COPY_LIMITS.HEADLINE_MAX} chars)`}>
          <input
            required
            maxLength={AD_COPY_LIMITS.HEADLINE_MAX}
            value={form.headline}
            onChange={(e) => setForm({ ...form, headline: e.target.value })}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label={`Body (max ${AD_COPY_LIMITS.BODY_MAX} chars)`}>
          <textarea
            required
            maxLength={AD_COPY_LIMITS.BODY_MAX}
            value={form.bodyText}
            onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
            rows={2}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="CTA text">
            <input
              required
              maxLength={AD_COPY_LIMITS.CTA_MAX}
              value={form.ctaText}
              onChange={(e) => setForm({ ...form, ctaText: e.target.value })}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Target URL">
            <input
              required
              type="url"
              value={form.targetUrl}
              onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Daily budget ($)">
            <input
              required
              type="number"
              min={1}
              step="0.01"
              value={form.dailyBudgetMicro / 1_000_000}
              onChange={(e) => setForm({ ...form, dailyBudgetMicro: Math.round(Number(e.target.value) * 1_000_000) })}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Bid per 5s verified view ($)">
            <input
              required
              type="number"
              min={0.001}
              step="0.001"
              value={form.cpiMicro / 1_000_000}
              onChange={(e) => setForm({ ...form, cpiMicro: Math.round(Number(e.target.value) * 1_000_000) })}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700">
          Create &amp; activate
        </button>
        {message && <p className="text-sm text-neutral-600">{message}</p>}
      </form>

      <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <h2 className="border-b border-neutral-200 px-4 py-3 font-semibold">Campaigns</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Impressions</th>
              <th className="px-4 py-2">5s completion</th>
              <th className="px-4 py-2">CTR</th>
              <th className="px-4 py-2">Spend</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const s = stats[c.id];
              return (
                <tr key={c.id} className="border-t border-neutral-100">
                  <td className="px-4 py-2">{c.name}</td>
                  <td className="px-4 py-2 capitalize">{c.status}</td>
                  <td className="px-4 py-2">{s?.impressions ?? "—"}</td>
                  <td className="px-4 py-2">{s ? `${(s.completionRate * 100).toFixed(1)}%` : "—"}</td>
                  <td className="px-4 py-2">{s ? `${(s.ctr * 100).toFixed(2)}%` : "—"}</td>
                  <td className="px-4 py-2">{formatMicroCents(Number(c.spentTotalMicro))}</td>
                </tr>
              );
            })}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">
                  No campaigns yet — create your first above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
