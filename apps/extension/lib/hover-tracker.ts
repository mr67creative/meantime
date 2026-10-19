import { HOVER_INTENT_MIN_MS } from "@meantime/shared";

/**
 * Intentional-hover tracker. A hover only counts toward engagement after it
 * has been continuous for at least HOVER_INTENT_MIN_MS (500ms). Brief
 * pass-throughs on the way to another control are discarded, so the
 * advertiser-facing "intentional hover" metric reflects real attention.
 */
export class HoverTracker {
  private hoverStart: number | null = null; // pointer entered
  private intentAt: number | null = null; // crossed the 500ms threshold
  private totalMs = 0;
  private timer: number | null = null;

  constructor(private readonly target: HTMLElement) {}

  start(): void {
    this.target.addEventListener("pointerenter", this.onEnter, { passive: true });
    this.target.addEventListener("pointerleave", this.onLeave, { passive: true });
  }

  private onEnter = () => {
    this.hoverStart = performance.now();
    this.intentAt = null;
    this.timer = window.setTimeout(() => {
      this.intentAt = performance.now(); // intent threshold crossed
      this.timer = null;
    }, HOVER_INTENT_MIN_MS);
  };

  private onLeave = () => {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Accrue only the time spent past the intent threshold.
    if (this.intentAt !== null) {
      this.totalMs += performance.now() - this.intentAt;
    }
    this.hoverStart = null;
    this.intentAt = null;
  };

  get hoverMs(): number {
    let ms = this.totalMs;
    if (this.intentAt !== null) ms += performance.now() - this.intentAt; // still hovering, past threshold
    return ms;
  }

  get intentional(): boolean {
    return this.intentAt !== null || this.totalMs > 0;
  }

  destroy(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.target.removeEventListener("pointerenter", this.onEnter);
    this.target.removeEventListener("pointerleave", this.onLeave);
  }
}
