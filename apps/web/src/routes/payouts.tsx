import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PAYOUT_THRESHOLD_USD, type UserBalance } from "@meantime/shared";
import { api } from "../lib/api";
import { formatMicroCents } from "../lib/format";
import { Shell, PageHeader } from "../lib/shell";

export const Route = createFileRoute("/payouts")({
  component: Payouts,
});

const METHODS = [
  { value: "paypal", label: "PayPal" },
  { value: "stripe_connect", label: "Stripe Connect" },
  { value: "wise", label: "Wise" },
  { value: "usdc", label: "USDC" },
  { value: "usdt", label: "USDT" },
];

function Payouts() {
  const [balance, setBalance] = useState<UserBalance | null>(null);
  const [method, setMethod] = useState("paypal");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api<UserBalance>("/me/balance").then(setBalance).catch(() => undefined);
  }, []);

  const canWithdraw = balance !== null && balance.availableMicro >= PAYOUT_THRESHOLD_USD;

  async function request(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!balance) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ status: string; trustScore: number }>("/payouts/request", {
        method: "POST",
        json: { method, address, amountMicro: balance.availableMicro },
      });
      setMessage(`Request submitted — status: ${res.status} (trust score ${res.trustScore}).`);
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader title="Withdraw" description="Minimum $5.00. Every payout passes a fraud audit first." />

      <div className="grid max-w-2xl grid-cols-1 gap-6">
        <div className="card-pad">
          <p className="text-[13px] text-neutral-500">Available balance</p>
          <p className="tabular mt-1 text-3xl font-semibold tracking-tight">
            {balance ? formatMicroCents(balance.availableMicro) : "—"}
          </p>
          <p className="mt-1 text-sm text-neutral-400">
            Minimum withdrawal {formatMicroCents(PAYOUT_THRESHOLD_USD)}
          </p>
        </div>

        <form onSubmit={request} className="card-pad space-y-4">
          <div>
            <label className="label">Payout method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="input">
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Destination address or email</label>
            <input required value={address} onChange={(e) => setAddress(e.target.value)}
              placeholder="you@example.com or wallet address" className="input" />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={!canWithdraw || busy} className="btn-primary">
              {busy ? "Submitting…" : canWithdraw ? "Request payout" : "Below $5.00 threshold"}
            </button>
            {message && <p className="text-sm text-neutral-500">{message}</p>}
          </div>
        </form>

        <p className="text-sm text-neutral-400">
          The audit only flags bots and multi-account abuse — heavy, legitimate
          AI use is never penalized.
        </p>
      </div>
    </Shell>
  );
}
