import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatMicroCents } from "../lib/format";
import { Shell, PageHeader } from "../lib/shell";
import { Stat } from "../lib/ui";

export const Route = createFileRoute("/referrals")({
  component: Referrals,
});

interface ReferralStats {
  code: string;
  link: string;
  total: number;
  pending: number;
  paid: number;
  earnedMicro: number;
}

function Referrals() {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<ReferralStats>("/me/referrals").then(setStats).catch(() => undefined);
  }, []);

  function copy(): void {
    if (!stats) return;
    void navigator.clipboard.writeText(stats.link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Shell>
      <PageHeader
        title="Referrals"
        description="Earn $0.50 for each friend who joins and earns $1.00 in verified views."
      />

      <div className="grid max-w-3xl grid-cols-1 gap-6">
        <div className="card-pad">
          <p className="text-[13px] text-neutral-500">Your referral link</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
              {stats?.link ?? "…"}
            </code>
            <button onClick={copy} className="btn-outline shrink-0">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            The bonus vests only after your friend earns $1.00 through real,
            verified use — so there's no way to game it with throwaway accounts.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Referred" value={String(stats?.total ?? "—")} />
          <Stat label="Pending" value={String(stats?.pending ?? "—")} />
          <Stat label="Paid" value={String(stats?.paid ?? "—")} />
          <Stat label="Earned" value={stats ? formatMicroCents(stats.earnedMicro) : "—"} />
        </div>
      </div>
    </Shell>
  );
}
