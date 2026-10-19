import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PAYOUT_THRESHOLD_USD, type TransparencyLogEntry, type UserBalance } from "@meantime/shared";
import { api } from "../lib/api";
import { formatMicro, formatMicroCents, formatMs } from "../lib/format";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const [balance, setBalance] = useState<UserBalance | null>(null);
  const [log, setLog] = useState<TransparencyLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<UserBalance>("/me/balance").then(setBalance).catch((e) => setError(String(e)));
    api<TransparencyLogEntry[]>("/me/impressions").then(setLog).catch(() => undefined);
  }, []);

  if (error) return <p className="p-8 text-red-600">Failed to load: {error}</p>;
  if (!balance) return <p className="p-8">Loading…</p>;

  const pct = Math.min(100, (balance.availableMicro / balance.thresholdMicro) * 100);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Earnings dashboard</h1>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Available" value={formatMicroCents(balance.availableMicro)} />
        <StatCard label="Pending verification" value={formatMicro(balance.pendingMicro)} />
        <StatCard label="Lifetime earned" value={formatMicro(balance.lifetimeMicro)} />
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-neutral-500">To withdrawal</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200">
            <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-sm font-semibold">
            {formatMicroCents(balance.availableMicro)} / {formatMicroCents(PAYOUT_THRESHOLD_USD)}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <h2 className="border-b border-neutral-200 px-4 py-3 font-semibold">Transparency log</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Platform</th>
              <th className="px-4 py-2">Ad</th>
              <th className="px-4 py-2">View time</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Earned</th>
            </tr>
          </thead>
          <tbody>
            {log.map((entry) => (
              <tr key={entry.impressionId} className="border-t border-neutral-100">
                <td className="px-4 py-2 text-neutral-500">
                  {new Date(entry.viewedAt).toLocaleString()}
                </td>
                <td className="px-4 py-2 capitalize">{entry.platform}</td>
                <td className="px-4 py-2 max-w-[220px] truncate">{entry.campaignHeadline}</td>
                <td className="px-4 py-2">{formatMs(entry.cumulativeVisibleMs)}</td>
                <td className="px-4 py-2">
                  <span
                    className={
                      entry.eligible
                        ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                        : "rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600"
                    }
                  >
                    {entry.eligible ? "Eligible" : "Early close"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {entry.eligible ? formatMicro(entry.earnedMicro) : "—"}
                </td>
              </tr>
            ))}
            {log.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">
                  No impressions yet — install the extension and prompt an AI.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}
