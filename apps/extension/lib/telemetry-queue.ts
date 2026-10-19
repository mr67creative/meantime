import type { ImpressionEvent, TelemetryBatch } from "@meantime/shared";
import { TELEMETRY } from "@meantime/shared";
import { STORAGE_KEYS, storageGet, storageSet, uuidv4 } from "./storage";

export interface QueuedImpression extends ImpressionEvent {
  queuedAt: number;
}

export async function queueImpression(event: ImpressionEvent): Promise<number> {
  const queue = await storageGet<QueuedImpression[]>(STORAGE_KEYS.PENDING_TELEMETRY, []);
  queue.push({ ...event, queuedAt: Date.now() });
  await storageSet(STORAGE_KEYS.PENDING_TELEMETRY, queue);
  return queue.length;
}

export async function pendingCount(): Promise<number> {
  return (await storageGet<QueuedImpression[]>(STORAGE_KEYS.PENDING_TELEMETRY, [])).length;
}

/** Drain the queue after a successful flush. */
export async function drainQueue(): Promise<QueuedImpression[]> {
  const queue = await storageGet<QueuedImpression[]>(STORAGE_KEYS.PENDING_TELEMETRY, []);
  await storageSet(STORAGE_KEYS.PENDING_TELEMETRY, []);
  return queue;
}

/** Re-enqueue on flush failure (network offline), bounded to avoid unbounded growth. */
export async function restoreQueue(events: QueuedImpression[]): Promise<void> {
  const queue = await storageGet<QueuedImpression[]>(STORAGE_KEYS.PENDING_TELEMETRY, []);
  const merged = [...events, ...queue].slice(-200);
  await storageSet(STORAGE_KEYS.PENDING_TELEMETRY, merged);
}

export function buildBatch(
  events: QueuedImpression[],
  deviceId: string,
  extensionVersion: string,
): TelemetryBatch {
  return {
    batchId: uuidv4(),
    deviceId,
    extensionVersion,
    sentAt: Date.now(),
    events: events
      .slice(0, TELEMETRY.MAX_EVENTS_PER_BATCH)
      .map(({ queuedAt: _queuedAt, ...event }) => event),
  };
}
