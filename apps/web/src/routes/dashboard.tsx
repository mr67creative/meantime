import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PAYOUT_THRESHOLD_USD, type TransparencyLogEntry, type UserBalance } from "@meantime/shared";
import { api } from "../lib/api";
import { formatMicro, formatMicroCents, formatMs } from "../lib/format";
import { Shell, PageHeader } from "../lib/shell";
import { Stat, Badge, Empty, Table } from "../lib/ui";

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

  return (
    <Shell>
      <PageHeader
        title="Earnings"
        description="Your balance and a full, auditable log of every ad."
      />

      {error && <p className="mb-4 text-sm text-red-600">Failed to load: {error}</p>}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Available" value={balance ? formatMicroCents(balance.availableMicro) : "—"} />
        <Stat label="Pending verification" value={balance ? formatMicro(balance.pendingMicro) : "—"} />
        <Stat label="Lifetime earned" value={balance ? formatMicro(balance.lifetimeMicro) : "—"} />
        <div className="card-pad">
          <p className="text-[13px] text-neutral-500">To withdrawal</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{
                width: `${balance ? Math.min(100, (balance.availableMicro / balance.thresholdMicro) * 100) : 0}%`,
              }}
            />
          </div>
          <p className="tabular mt-2 text-sm font-medium text-neutral-700">
            {balance ? formatMicroCents(balance.availableMicro) : "—"}{" "}
            <span className="font-normal text-neutral-400">
              / {formatMicroCents(PAYOUT_THRESHOLD_USD)}
            </span>
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">Transparency log</h2>
        <Table head={["When", "Platform", "Ad", "View time", "Status", "Earned"]}>
          {log.map((entry) => (
            <tr key={entry.impressionId}>
              <td className="px-4 py-3 text-neutral-500">
                {new Date(entry.viewedAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 capitalize">{entry.platform}</td>
              <td className="max-w-[220px] truncate px-4 py-3">{entry.campaignHeadline}</td>
              <td className="tabular px-4 py-3">{formatMs(entry.cumulativeVisibleMs)}</td>
              <td className="px-4 py-3">
                <Badge tone={entry.eligible ? "good" : "neutral"}>
                  {entry.eligible ? "Eligible" : "Early close"}
                </Badge>
              </td>
              <td className="tabular px-4 py-3 text-right">
                {entry.eligible ? formatMicro(entry.earnedMicro) : "—"}
              </td>
            </tr>
          ))}
          {log.length === 0 && (
            <tr>
              <td colSpan={6}>
                <Empty
                  title="No impressions yet"
                  hint="Install the extension and send a prompt to any supported AI."
                />
              </td>
            </tr>
          )}
        </Table>
      </section>
    </Shell>
  );
}
