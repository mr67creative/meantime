import { PLATFORM_CONFIGS } from "@meantime/shared";
import { BaseAdapter } from "./base";

export class OpenAiAdapter extends BaseAdapter {
  readonly platformId = "openai";
  readonly config = PLATFORM_CONFIGS.openai;

  override getUserMessageActionSlot(latestMessageNode: HTMLElement): HTMLElement | null {
    return (
      latestMessageNode.querySelector<HTMLElement>("div[class*='action'], .text-token-text-secondary")
      ?? latestMessageNode
    );
  }
}

export class GeminiAdapter extends BaseAdapter {
  readonly platformId = "gemini";
  readonly config = PLATFORM_CONFIGS.gemini;
}

export class ClaudeAdapter extends BaseAdapter {
  readonly platformId = "claude";
  readonly config = PLATFORM_CONFIGS.claude;
}

export class DeepseekAdapter extends BaseAdapter {
  readonly platformId = "deepseek";
  readonly config = PLATFORM_CONFIGS.deepseek;
}

export class GrokAdapter extends BaseAdapter {
  readonly platformId = "grok";
  readonly config = PLATFORM_CONFIGS.grok;

  /** x.com hosts Grok only under /i/grok; grok.com matches everywhere. */
  override matches(hostname: string, pathname: string): boolean {
    const host = hostname.toLowerCase();
    if (host === "grok.com" || host.endsWith(".grok.com")) return true;
    if (host === "x.com" || host.endsWith(".x.com")) {
      return pathname.startsWith("/i/grok");
    }
    return false;
  }
}
