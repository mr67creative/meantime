import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="text-5xl font-bold tracking-tight">MeanTime</h1>
        <p className="mt-4 text-lg text-neutral-600">
          Text-only micro-ads shown during the real wait time between your AI
          prompt and its response. You control them, and you keep 55% of the
          revenue.
        </p>
      </div>

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          ["For users", "Earn 55% of every verified 5-second view. No banners, no pop-ups, full control."],
          ["For advertisers", "High-intent placement right where tech-savvy users are already looking."],
          ["For everyone", "A fair, transparent split — near-zero overhead, edge-cached delivery."],
        ].map(([title, body]) => (
          <div key={title} className="rounded-xl border border-neutral-200 bg-white p-5 text-left shadow-sm">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-neutral-600">{body}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <Link to="/dashboard" className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700">
          Open dashboard
        </Link>
        <Link to="/advertiser" className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold hover:bg-neutral-100">
          Advertiser portal
        </Link>
      </div>
    </main>
  );
}
