import type { PohiSignals } from "@meantime/shared";
import { STORAGE_KEYS, storageSet } from "./storage";

/**
 * Privacy-preserving Proof of Human Interaction. Tracks ONLY behavioral
 * scalars (trusted event counts) — never reads input values, never touches
 * prompt text.
 */
export class PohiCollector {
  private trustedKeys = 0;
  private trustedPaste = false;
  private detachFns: Array<() => void> = [];

  attach(inputRoot: HTMLElement): void {
    this.detach();
    const onKeydown = (e: Event) => {
      if (e.isTrusted) this.trustedKeys++;
    };
    const onPaste = (e: Event) => {
      if (e.isTrusted) this.trustedPaste = true;
    };
    inputRoot.addEventListener("keydown", onKeydown, { capture: true, passive: true });
    inputRoot.addEventListener("paste", onPaste, { capture: true, passive: true });
    this.detachFns = [
      () => inputRoot.removeEventListener("keydown", onKeydown, { capture: true }),
      () => inputRoot.removeEventListener("paste", onPaste, { capture: true }),
    ];
  }

  reset(): void {
    this.trustedKeys = 0;
    this.trustedPaste = false;
  }

  detach(): void {
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
  }

  /**
   * Score in [0, 1]: >3 trusted keystrokes or one trusted paste => 1.0;
   * partial credit otherwise. Zero when only synthetic events were seen.
   */
  score(): number {
    if (this.trustedKeys > 3) return 1;
    if (this.trustedPaste) return 1;
    if (this.trustedKeys > 0) return this.trustedKeys / 4;
    return 0;
  }

  snapshot(aiMutationVerified: boolean): PohiSignals {
    return {
      inputInteractionScore: this.score(),
      keystrokeCount: this.trustedKeys,
      trustedPasteSeen: this.trustedPaste,
      aiMutationVerified,
    };
  }
}

/** Expose the latest PoHI snapshot to the service worker via storage. */
export async function persistPohiSnapshot(signals: PohiSignals): Promise<void> {
  await storageSet(STORAGE_KEYS.POHI_SNAPSHOT, { ...signals, at: Date.now() });
}
