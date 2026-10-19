# MeanTime

Text-only micro-ads shown during the real wait time between submitting an AI
prompt and the AI's response — with 55% of ad spend going to the user.

## Monorepo layout

| Path | What |
|---|---|
| `packages/shared` | TypeScript contracts, zod validators, HMAC lease-token crypto, Drizzle PostgreSQL schema, platform selector configs. |
| `apps/extension` | Manifest V3 browser extension (WXT). The 3-pillar lightweight engine: idle prefetch + local ad registry, event-driven trigger + multi-LLM adapters, cumulative viewport timer + batched telemetry. |
| `apps/api` | Fastify API. Ad prefetch/lease issuance, telemetry batch ingestion, social tasks, payouts, and the 5-layer anti-fraud engine. |
| `apps/web` | TanStack Start web app: user earnings dashboard, transparency log, task center, withdrawal portal, advertiser self-serve portal. |

## Quickstart

```bash
pnpm install

# 1. Database + migrations
docker compose up -d            # postgres + redis (see docker-compose.yml)
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 2. API
cd apps/api && cp .env.example .env
pnpm --filter @meantime/api dev

# 3. Web app
pnpm --filter @meantime/web dev

# 4. Extension (loads into Chrome via chrome://extensions -> Load unpacked -> apps/extension/.output/chrome-mv3)
pnpm --filter @meantime/extension build
```

## The 3-pillar extension engine

1. **Idle prefetch & local registry.** The background service worker only
   fetches during `chrome.idle` or when the ring-buffer cache drops below 5
   ads. Max 25 ads, ~15KB total in `chrome.storage.local`. Every ad carries a
   single-use, HMAC-signed `lease_token` and frequency-cap metadata, so the
   content script can deduplicate locally with zero network calls.

2. **Event-driven trigger & adapters.** A single passive `keydown`/`pointerdown`
   listener on the composer detects prompt submission (Enter without
   Shift/composition, or a send-button press). The `PlatformAdapter` interface
   keeps each AI platform under 30 lines. Injection goes into a closed Shadow
   DOM, inline beneath the user's prompt bubble, in under 8ms — no layout
   shift.

3. **Cumulative viewport timer & batched telemetry.** `IntersectionObserver`
   (75% threshold) + `document.visibilityState` + window focus feed one
   "actively viewable" signal, integrated with `performance.now()` deltas.
   5,000ms cumulative pays out. Completed impressions queue locally and flush
   as one compressed batch every 15 minutes or 15 items — never one request
   per view.

## Anti-fraud layers

1. **Cryptographic leases** — HMAC-SHA256, single-use, Redis SETNX + DB fallback.
2. **Proof of Human Interaction** — `isTrusted` event scalars and host-DOM
   mutation checks; never reads prompt text.
3. **Temporal entropy** — inter-prompt interval CV flags robotic cadence
   (CV < 0.08 over ≥15 prompts); viewport-duration clustering catches
   "exactly 5001ms" scripts.
4. **Velocity dampening** — pacing tiers (12/hr full, 13–25 throttled, >25
   silent cap) protect advertisers without falsely banning power users.
5. **Pre-withdrawal sybil check** — composite trust score over account age,
   IP/ASN diversity, payout-address uniqueness, PoHI ratio, and cadence.
