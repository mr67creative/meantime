import type { ReactNode } from "react";

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card-pad">
      <p className="text-[13px] text-neutral-500">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
    </div>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad";

const TONE_STYLES: Record<Tone, string> = {
  neutral: "bg-neutral-100 text-neutral-700",
  good: "bg-accent-soft text-accent",
  warn: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-700",
};

const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-neutral-400",
  good: "bg-accent",
  warn: "bg-amber-500",
  bad: "bg-red-500",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`badge ${TONE_STYLES[tone]}`}>
      <span className={`dot ${TONE_DOT[tone]}`} />
      {children}
    </span>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-sm font-medium text-neutral-600">{title}</p>
      {hint && <p className="mt-1 text-sm text-neutral-400">{hint}</p>}
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">{children}</tbody>
      </table>
    </div>
  );
}
