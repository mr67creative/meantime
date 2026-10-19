import {
  EXTENSION_CACHE,
  TELEMETRY,
  type PrefetchResponse,
  type TelemetryBatchResponse,
} from "@meantime/shared";
import { cacheSize, getCachedAds, setCachedAds, takeAd } from "../lib/ad-cache";
import { apiFetch } from "../lib/api-client";
import {
  buildBatch,
  drainQueue,
  pendingCount,
  queueImpression,
  restoreQueue,
  type QueuedImpression,
} from "../lib/telemetry-queue";
import {
  STORAGE_KEYS,
  storageGet,
  storageSet,
  type Identity,
  type PromptCounter,
} from "../lib/storage";

const FLUSH_ALARM = "meantime:telemetry-flush";
const EXTENSION_VERSION = "0.1.0";

export default defineBackground(() => {
  const sw = new MeanTimeBackground();
  sw.start();
});

class MeanTimeBackground {
  start(): void {
    chrome.alarms.create(FLUSH_ALARM, {
      periodInMinutes: TELEMETRY.FLUSH_INTERVAL_MINUTES,
    });

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === FLUSH_ALARM) void this.flushTelemetry();
    });

    chrome.idle.onStateChanged.addListener((state) => {
      if (state === "idle") void this.prefetchIfNeeded();
    });

    chrome.runtime.onInstalled.addListener(() => void this.prefetchIfNeeded(true));
    chrome.runtime.onStartup.addListener(() => void this.prefetchIfNeeded(true));

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      void this.handleMessage(msg).then(sendResponse);
      return true; // async response
    });
  }

  private async handleMessage(msg: {
    type: string;
    event?: Parameters<typeof queueImpression>[0];
    impressionId?: string;
    leaseToken?: string;
  }): Promise<unknown> {
    switch (msg.type) {
      case "take_ad":
        return takeAd();
      case "queue_impression": {
        if (!msg.event) return null;
        const counter = await storageGet<PromptCounter>(STORAGE_KEYS.PROMPT_COUNTER, {
          windowStart: Date.now(),
          count: 0,
        });
        msg.event.promptsLastHour = counter.count;
        const size = await queueImpression(msg.event);
        if (size >= TELEMETRY.FLUSH_QUEUE_SIZE) void this.flushTelemetry();
        return { queued: size };
      }
      case "ad_click":
        if (msg.impressionId && msg.leaseToken) {
          void apiFetch("/ads/click", {
            method: "POST",
            json: { impressionId: msg.impressionId, leaseToken: msg.leaseToken },
          }).catch(() => undefined);
        }
        return null;
      case "flush_now":
        await this.flushTelemetry();
        return null;
      case "cache_status":
        return { size: await cacheSize(), pending: await pendingCount() };
      default:
        return null;
    }
  }

  /* ------------------------------ prefetching ---------------------------- */

  private async prefetchIfNeeded(force = false): Promise<void> {
    const identity = await storageGet<Identity | null>(STORAGE_KEYS.IDENTITY, null);
    if (!identity) return;

    const size = await cacheSize();
    if (!force && size >= EXTENSION_CACHE.LOW_WATER_MARK) return;

    const lockKey = "prefetch_lock";
    const lock = await chrome.storage.local.get(lockKey);
    if (typeof lock[lockKey] === "number" && Date.now() - lock[lockKey] < 30_000) return;
    await chrome.storage.local.set({ [lockKey]: Date.now() });

    try {
      const count = EXTENSION_CACHE.PREFETCH_BATCH_SIZE;
      const res = await apiFetch<PrefetchResponse>("/ads/prefetch", {
        method: "POST",
        json: { deviceId: identity.deviceId, count, platforms: [] },
      });
      const pool = await getCachedAds();
      const knownLeaseIds = new Set(pool.map((a) => a.leaseId));
      const fresh = res.ads.filter((a) => !knownLeaseIds.has(a.leaseId));
      await setCachedAds([...pool, ...fresh]);
      await storageSet("pacing_state", res.pacing);
    } catch {
      // Offline or API down — keep serving the existing cache.
    }
  }

  /* ------------------------------- telemetry ----------------------------- */

  private async flushTelemetry(): Promise<void> {
    if ((await pendingCount()) === 0) return;
    const identity = await storageGet<Identity | null>(STORAGE_KEYS.IDENTITY, null);
    if (!identity) return;

    const events: QueuedImpression[] = await drainQueue();
    if (events.length === 0) return;

    const batch = buildBatch(events, identity.deviceId, EXTENSION_VERSION);
    try {
      await apiFetch<TelemetryBatchResponse>("/telemetry/batch", {
        method: "POST",
        json: batch,
        compress: true,
      });
    } catch {
      await restoreQueue(events);
    }
  }
}
