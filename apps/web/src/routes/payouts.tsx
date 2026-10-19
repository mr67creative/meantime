import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PAYOUT_THRESHOLD_USD, type UserBalance } from "@meantime/shared";
import { api } from "../lib/api";
import { formatMicroCents } from "../lib/format";

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
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Withdraw earnings</h1>

      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-neutral-500">Available balance</p>
        <p className="mt-1 text-3xl font-bold">
          {balance ? formatMicroCents(balance.availableMicro) : "—"}
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          Minimum withdrawal: {formatMicroCents(PAYOUT_THRESHOLD_USD)}
        </p>
      </div>

      <form onSubmit={request} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div>
          <label className="block text-sm font-medium">Payout method</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Destination address / email</label>
          <input
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="you@example.com or wallet address"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={!canWithdraw || busy}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy ? "Submitting…" : canWithdraw ? "Request payout" : "Below $5.00 threshold"}
        </button>
        {message && <p className="text-sm text-neutral-600">{message}</p>}
      </form>

      <p className="text-sm text-neutral-500">
        Every payout passes a pre-payout fraud audit. Fast, heavy AI users are
        never penalized — the audit only flags bots, replayed impressions, and
        multi-account bonus farming.
      </p>
    </main>
  );
}
