import type { PrefetchedAd } from "@meantime/shared";
import { EXTENSION_CACHE } from "@meantime/shared";
import {
  STORAGE_KEYS,
  storageGet,
  storageSet,
  type ImpressionHistory,
} from "./storage";

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export async function getCachedAds(): Promise<PrefetchedAd[]> {
  return storageGet<PrefetchedAd[]>(STORAGE_KEYS.AD_CACHE, []);
}

export async function setCachedAds(ads: PrefetchedAd[]): Promise<void> {
  // Ring buffer: keep the newest MAX_CACHED_ADS entries.
  await storageSet(
    STORAGE_KEYS.AD_CACHE,
    ads.slice(-EXTENSION_CACHE.MAX_CACHED_ADS),
  );
}

export async function cacheSize(): Promise<number> {
  return (await getCachedAds()).length;
}

export async function getHistory(): Promise<ImpressionHistory> {
  return storageGet<ImpressionHistory>(STORAGE_KEYS.IMPRESSION_HISTORY, {});
}

/**
 * Local deduplication engine — pure, synchronous, zero network. Removes ads
 * whose lease expired, whose per-day cap is reached, or whose campaign is
 * still in cooldown.
 */
export function filterEligible(
  pool: PrefetchedAd[],
  history: ImpressionHistory,
  now: number,
): PrefetchedAd[] {
  const today = dayKey(now);
  return pool.filter((ad) => {
    if (ad.expiresAt * 1000 <= now) return false;
    const rec = history[ad.campaignId];
    if (!rec) return true;
    const viewsToday = rec.days.filter((d) => d === today).length;
    if (viewsToday >= ad.frequencyCap.maxPerDay) return false;
    if (now - rec.lastShownAt < ad.frequencyCap.cooldownSec * 1000) return false;
    return true;
  });
}

/**
 * Pop the next eligible ad out of the cache and record it in the local
 * impression history. Returns null when nothing qualifies.
 */
export async function takeAd(now = Date.now()): Promise<PrefetchedAd | null> {
  const [pool, history] = await Promise.all([getCachedAds(), getHistory()]);
  const eligible = filterEligible(pool, history, now);
  const chosen = eligible[0];
  if (!chosen) return null;

  const remaining = pool.filter((a) => a.leaseId !== chosen.leaseId);
  await setCachedAds(remaining);

  const rec = history[chosen.campaignId] ?? { days: [], lastShownAt: 0 };
  rec.days.push(dayKey(now));
  // Keep history compact: only the last 7 day-keys matter for any realistic cap.
  rec.days = rec.days.slice(-7);
  rec.lastShownAt = now;
  history[chosen.campaignId] = rec;
  await storageSet(STORAGE_KEYS.IMPRESSION_HISTORY, history);

  return chosen;
}
