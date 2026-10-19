import type { PlatformId } from "./constants.js";

/**
 * Host/selector configuration shared by the extension's PlatformAdapter
 * implementations and the API's campaign targeting. Selectors live here (not
 * hardcoded in the extension bundle) so a platform DOM change can be patched
 * server-side via the /config endpoint without shipping a new extension build.
 */

export interface PlatformSelectorConfig {
  platformId: PlatformId;
  hostPatterns: string[];
  promptInputSelector: string;
  sendButtonSelector: string;
  thinkingIndicatorSelector: string;
  streamingContainerSelector: string;
  generationCompleteSelector: string;
  userMessageSelector: string;
  aiMessageSelector: string;
}

export const PLATFORM_CONFIGS: Record<PlatformId, PlatformSelectorConfig> = {
  openai: {
    platformId: "openai",
    hostPatterns: ["chatgpt.com", "chat.openai.com"],
    promptInputSelector: "#prompt-textarea, div.ProseMirror[contenteditable='true']",
    sendButtonSelector:
      "button[data-testid='send-button'], button[aria-label='Send prompt']",
    thinkingIndicatorSelector:
      "div[data-testid='thinking-indicator'], span:has(> .loading-shimmer)",
    streamingContainerSelector: "div[data-message-author-role='assistant'] .markdown",
    generationCompleteSelector:
      "button[data-testid='copy-turn-action-button']",
    userMessageSelector: "div[data-message-author-role='user']",
    aiMessageSelector: "div[data-message-author-role='assistant']",
  },
  gemini: {
    platformId: "gemini",
    hostPatterns: ["gemini.google.com"],
    promptInputSelector: "div.ql-editor[contenteditable='true'], rich-textarea div[contenteditable='true']",
    sendButtonSelector: "button.send-button, button[aria-label='Send message']",
    thinkingIndicatorSelector: ".loading-indicator, .spark-throbber",
    streamingContainerSelector: "message-content .markdown",
    generationCompleteSelector: "response-container .response-container-footer",
    userMessageSelector: "user-query",
    aiMessageSelector: "model-response",
  },
  grok: {
    platformId: "grok",
    hostPatterns: ["grok.com", "x.com"],
    promptInputSelector: "div[contenteditable='true'].notranslate, textarea[aria-label*='Ask']",
    sendButtonSelector: "button[type='submit'], button[aria-label='Send']",
    thinkingIndicatorSelector: "div[role='status'], .thinking-bubble",
    streamingContainerSelector: "div.message-bubble .markdown",
    generationCompleteSelector: "div.action-bar button[aria-label='Copy']",
    userMessageSelector: "div[data-testid='user-message'], div.message-bubble.human",
    aiMessageSelector: "div[data-testid='ai-message'], div.message-bubble.ai",
  },
  claude: {
    platformId: "claude",
    hostPatterns: ["claude.ai"],
    promptInputSelector: "div.ProseMirror[contenteditable='true']",
    sendButtonSelector: "button[aria-label='Send Message'], button[aria-label='Send message']",
    thinkingIndicatorSelector: "div[data-is-streaming='true'], .loading-dots",
    streamingContainerSelector: "div[data-testid='ai-message-content'], .font-claude-message",
    generationCompleteSelector: "button[aria-label='Copy response']",
    userMessageSelector: "div[data-testid='user-message'], .font-user-message",
    aiMessageSelector: "div[data-testid='ai-message'], .font-claude-message",
  },
  deepseek: {
    platformId: "deepseek",
    hostPatterns: ["chat.deepseek.com"],
    promptInputSelector: "textarea#chat-input, div[contenteditable='true']",
    sendButtonSelector: "div[role='button'][aria-label='Send'], button.send-button",
    thinkingIndicatorSelector: ".thinking-status, .loading-dot",
    streamingContainerSelector: "div.ds-markdown",
    generationCompleteSelector: "div.ds-message-actions",
    userMessageSelector: "div.ds-message.human, div[class*='user-message']",
    aiMessageSelector: "div.ds-message.ai, div[class*='ai-message']",
  },
};

export function configForHostname(hostname: string): PlatformSelectorConfig | null {
  const host = hostname.toLowerCase();
  for (const cfg of Object.values(PLATFORM_CONFIGS)) {
    for (const pattern of cfg.hostPatterns) {
      if (host === pattern || host.endsWith(`.${pattern}`)) return cfg;
      // x.com/i/grok path-scoped matching handled by the adapter itself.
    }
  }
  return null;
}
