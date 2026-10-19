import type { PlatformSelectorConfig } from "@meantime/shared";

/**
 * Implement this interface to add a new AI platform. A minimal adapter is a
 * selector config plus three anchor-locator functions — well under 30 lines.
 */
export interface PlatformAdapter {
  readonly platformId: string;
  readonly hostPatterns: string[];
  readonly config: PlatformSelectorConfig;

  matches(hostname: string, pathname: string): boolean;

  /** Anchor under the user's just-submitted prompt bubble (primary position). */
  getUserMessageActionSlot(latestMessageNode: HTMLElement): HTMLElement | null;
  /** Anchor at the footer of the AI response block. */
  getAiMessageFooterSlot(latestAiNode: HTMLElement): HTMLElement | null;
  /** Anchor next to the "Thinking..." indicator. */
  getThinkingSlot(): HTMLElement | null;

  /** Latest user message node, used as the primary injection anchor. */
  findLatestUserMessage(): HTMLElement | null;
  /** Latest AI message node (may still be streaming). */
  findLatestAiMessage(): HTMLElement | null;
}

export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly platformId: string;
  abstract readonly config: PlatformSelectorConfig;

  get hostPatterns(): string[] {
    return this.config.hostPatterns;
  }

  matches(hostname: string, _pathname: string): boolean {
    const host = hostname.toLowerCase();
    return this.hostPatterns.some((p) => host === p || host.endsWith(`.${p}`));
  }

  protected qs<T extends Element = HTMLElement>(selector: string): T | null {
    return document.querySelector<T>(selector);
  }

  protected qsAll<T extends Element = HTMLElement>(selector: string): T[] {
    return Array.from(document.querySelectorAll<T>(selector));
  }

  /** Last match in document order. */
  protected last<T extends Element = HTMLElement>(selector: string): T | null {
    const all = this.qsAll<T>(selector);
    return all.length > 0 ? (all[all.length - 1] as T) : null;
  }

  findLatestUserMessage(): HTMLElement | null {
    return this.last(this.config.userMessageSelector);
  }

  findLatestAiMessage(): HTMLElement | null {
    return this.last(this.config.aiMessageSelector);
  }

  getUserMessageActionSlot(latestMessageNode: HTMLElement): HTMLElement | null {
    // Default: append to the message node's own footer/action row if it has
    // one, otherwise to the node itself. Adapters can refine.
    return (
      latestMessageNode.querySelector<HTMLElement>("[class*='action'], footer") ??
      latestMessageNode
    );
  }

  getAiMessageFooterSlot(latestAiNode: HTMLElement): HTMLElement | null {
    return (
      latestAiNode.querySelector<HTMLElement>("[class*='action'], footer") ??
      latestAiNode
    );
  }

  getThinkingSlot(): HTMLElement | null {
    return this.qs(this.config.thinkingIndicatorSelector)?.parentElement ?? null;
  }
}
