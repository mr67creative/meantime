import {
  MIN_VIEWABLE_MS,
  PACING,
  type CloseReason,
  type ImpressionEvent,
  type PohiSignals,
} from "@meantime/shared";
import { resolveAdapter } from "../lib/adapters/registry";
import type { PlatformAdapter } from "../lib/adapters/base";
import { AdWidget } from "../lib/ad-widget";
import { PohiCollector } from "../lib/pohi";
import { getSettings, saveSettings, STORAGE_KEYS, storageGet, uuidv4 } from "../lib/storage";
import type { PromptCounter } from "../lib/storage";

export default defineContentScript({
  matches: [
    "*://*.chatgpt.com/*",
    "*://*.chat.openai.com/*",
    "*://*.gemini.google.com/*",
    "*://*.grok.com/*",
    "*://*.x.com/i/grok*",
    "*://*.claude.ai/*",
    "*://*.chat.deepseek.com/*",
  ],
  runAt: "document_idle",
  main() {
    const adapter = resolveAdapter(location.hostname, location.pathname);
    if (!adapter) return;
    const controller = new MeanTimeController(adapter);
    controller.start();
  },
});

type TriggerSource = "enter_key" | "send_button";

class MeanTimeController {
  private readonly pohi = new PohiCollector();
  private attached = false;
  private activeWidget: AdWidget | null = null;
  private activeLease: {
    impressionId: string;
    submittedAt: number;
    displayMode: "wait_time_only" | "persist_until_5s";
    placement: "under_prompt" | "thinking_indicator" | "ai_footer";
    pohiAtSubmit: Omit<PohiSignals, "aiMutationVerified">;
    closed: boolean;
  } | null = null;
  private generationObserver: MutationObserver | null = null;
  private generationCleanupTimer: number | null = null;
  private firstOutputAt: number | null = null;

  constructor(private readonly adapter: PlatformAdapter) {}

  start(): void {
    this.tryAttach();
    // SPA navigations re-render the composer; re-attach after URL changes
    // without polling — hook history changes once.
    const onNavigate = () => setTimeout(() => this.tryAttach(), 300);
    const origPush = history.pushState;
    history.pushState = function (...args) {
      const ret = origPush.apply(this, args);
      onNavigate();
      return ret;
    };
    window.addEventListener("popstate", onNavigate, { passive: true });
  }

  /* ------------------------- trigger detection -------------------------- */

  private tryAttach(): void {
    const input = document.querySelector<HTMLElement>(
      this.adapter.config.promptInputSelector,
    );
    if (!input) {
      // Composer not mounted yet — retry on the next DOM mutation burst, once.
      const once = new MutationObserver(() => {
        if (document.querySelector(this.adapter.config.promptInputSelector)) {
          once.disconnect();
          this.tryAttach();
        }
      });
      once.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => once.disconnect(), 15_000);
      return;
    }
    if (this.attached) return;
    this.attached = true;

    const composer = input.closest("form, [class*='composer'], [class*='prompt']") ?? input;

    this.pohi.attach(input);

    composer.addEventListener(
      "keydown",
      (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === "Enter" && !ke.shiftKey && !ke.isComposing) {
          this.onPromptSubmitted("enter_key");
        }
      },
      { capture: true, passive: true },
    );

    document.addEventListener(
      "pointerdown",
      (e: Event) => {
        const target = e.target as Element | null;
        if (target?.closest(this.adapter.config.sendButtonSelector)) {
          this.onPromptSubmitted("send_button");
        }
      },
      { capture: true, passive: true },
    );
  }

  /* ------------------------------ lifecycle ----------------------------- */

  private async onPromptSubmitted(_source: TriggerSource): Promise<void> {
    const settings = await getSettings();
    if (!settings.enabled) return;
    if (settings.snoozedUntil === -1 || settings.snoozedUntil > Date.now()) return;
    if (this.activeWidget) return; // one ad at a time

    // Layer-4 pacing, enforced client-side against the local counter; the
    // server re-checks authoritatively at prefetch/telemetry time.
    if (!(await this.pacingAllows())) return;

    const snap = this.pohi.snapshot(false);
    const pohiAtSubmit = {
      inputInteractionScore: snap.inputInteractionScore,
      keystrokeCount: snap.keystrokeCount,
      trustedPasteSeen: snap.trustedPasteSeen,
    };

    // <8ms budget: cache read + dedup + mount. If it misses, stay silent.
    const t0 = performance.now();
    const ad = await chrome.runtime
      .sendMessage({ type: "take_ad" })
      .catch(() => null);
    if (!ad) return;

    const mountPoint = this.resolveMountPoint(settings.placement);
    if (!mountPoint) return;

    const impressionId = uuidv4();
    const submittedAt = Date.now();

    const widget = new AdWidget(ad, {
      onDismiss: (reason, snoozeMinutes) => {
        this.finalize(reason, ad.campaignId);
        if (reason === "snoozed" && typeof snoozeMinutes === "number") {
          const until =
            snoozeMinutes < 0 ? Number.MAX_SAFE_INTEGER : Date.now() + snoozeMinutes * 60_000;
          void saveSettings({ snoozedUntil: until });
        }
      },
      onEarned: () => {
        if (!this.activeLease) return;
        // Mode 2: earned before stream started — fade out now.
        this.finalize("earned", ad.campaignId);
      },
      onClickCta: () => {
        void chrome.runtime
          .sendMessage({
            type: "ad_click",
            impressionId,
            leaseToken: ad.leaseToken,
          })
          .catch(() => undefined);
      },
    });

    this.activeWidget = widget;
    this.activeLease = {
      impressionId,
      submittedAt,
      displayMode: settings.displayMode,
      placement: settings.placement,
      pohiAtSubmit,
      closed: false,
    };

    widget.mount(mountPoint);
    void t0; // mount completed; budget check happens in dev telemetry only

    this.pohi.reset();
    this.watchGeneration(widget);
  }

  private resolveMountPoint(placement: string): HTMLElement | null {
    switch (placement) {
      case "thinking_indicator":
        return this.adapter.getThinkingSlot() ?? this.fallbackMount();
      case "ai_footer": {
        const ai = this.adapter.findLatestAiMessage();
        return ai ? this.adapter.getAiMessageFooterSlot(ai) : this.fallbackMount();
      }
      case "under_prompt":
      default:
        return this.fallbackMount();
    }
  }

  private fallbackMount(): HTMLElement | null {
    const user = this.adapter.findLatestUserMessage();
    return user ? this.adapter.getUserMessageActionSlot(user) : null;
  }

  /* --------------------------- generation watch -------------------------- */

  /**
   * Scoped observer: attached to the response region (or chat container as a
   * fallback), never document.body-wide, removed the moment generation ends
   * or the ad closes. This is what the "no global MutationObserver" rule
   * allows: targeted, short-lived, teardown-guaranteed.
   */
  private watchGeneration(widget: AdWidget): void {
    const root =
      this.adapter.findLatestAiMessage()?.parentElement ??
      document.querySelector<HTMLElement>("main") ??
      document.body;

    let firstOutputAt: number | null = null;

    const completeSelector = this.adapter.config.generationCompleteSelector;
    const streamSelector = this.adapter.config.streamingContainerSelector;

    this.generationObserver = new MutationObserver(() => {
      if (firstOutputAt === null && root.querySelector(streamSelector)?.textContent?.trim()) {
        firstOutputAt = Date.now();
        this.firstOutputAt = firstOutputAt;
        this.onFirstAiOutput(widget);
      }
      if (root.querySelector(completeSelector)) {
        this.teardownObserver();
      }
    });
    this.generationObserver.observe(root, { childList: true, subtree: true });

    // Hard teardown guarantee: never observe longer than 3 minutes.
    this.generationCleanupTimer = window.setTimeout(() => this.teardownObserver(), 180_000);
  }

  private onFirstAiOutput(widget: AdWidget): void {
    if (!this.activeLease || this.activeLease.closed) return;

    if (this.activeLease.displayMode === "wait_time_only") {
      // Mode 1: instant removal the moment the AI starts streaming.
      this.finalize("stream_started", widget.ad.campaignId);
    } else if (widget.timer.cumulativeMs >= MIN_VIEWABLE_MS) {
      this.finalize("earned", widget.ad.campaignId);
    }
    // Mode 2 with < 5s accrued: keep the ad anchored; onEarned closes it.
  }

  private teardownObserver(): void {
    this.generationObserver?.disconnect();
    this.generationObserver = null;
    if (this.generationCleanupTimer !== null) {
      clearTimeout(this.generationCleanupTimer);
      this.generationCleanupTimer = null;
    }
  }

  /* ------------------------------ finalization --------------------------- */

  private finalize(reason: CloseReason, campaignId: string): void {
    const widget = this.activeWidget;
    const lease = this.activeLease;
    if (!widget || !lease || lease.closed) return;
    lease.closed = true;
    this.teardownObserver();

    const cumulativeVisibleMs = Math.round(widget.timer.cumulativeMs);
    const earned = cumulativeVisibleMs >= MIN_VIEWABLE_MS;
    const aiWaitDurationMs = (this.firstOutputAt ?? Date.now()) - lease.submittedAt;
    const aiMutationVerified = this.firstOutputAt !== null;
    this.firstOutputAt = null;

    widget.destroy(reason === "earned");
    this.activeWidget = null;
    this.activeLease = null;

    const event: ImpressionEvent = {
      impressionId: lease.impressionId,
      leaseToken: widget.ad.leaseToken,
      platform: this.adapter.platformId,
      placement: lease.placement,
      displayMode: lease.displayMode,
      submittedAt: lease.submittedAt,
      aiWaitDurationMs,
      cumulativeVisibleMs,
      closedReason: reason,
      earned,
      pohi: {
        ...lease.pohiAtSubmit,
        aiMutationVerified,
      },
      promptsLastHour: 0, // filled in by the service worker from the counter
    };

    void chrome.runtime
      .sendMessage({ type: "queue_impression", event, campaignId })
      .catch(() => undefined);
  }

  /* -------------------------------- pacing ------------------------------- */

  private async pacingAllows(): Promise<boolean> {
    const now = Date.now();
    let counter = await storageGet<PromptCounter>(STORAGE_KEYS.PROMPT_COUNTER, {
      windowStart: now,
      count: 0,
    });
    if (now - counter.windowStart > PACING.WINDOW_SECONDS * 1000) {
      counter = { windowStart: now, count: 0 };
    }
    counter.count++;
    await chrome.storage.local.set({ [STORAGE_KEYS.PROMPT_COUNTER]: counter });

    if (counter.count <= PACING.TIER1_MAX_PER_HOUR) return true;
    if (counter.count <= PACING.TIER2_MAX_PER_HOUR) {
      return counter.count % PACING.TIER2_PROMPT_DIVISOR === 0;
    }
    return false; // Tier 3: silent cap for the rest of the window.
  }
}
