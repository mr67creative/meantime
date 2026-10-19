import type { Identity } from "./storage";

const DEFAULT_API_BASE = "https://api.meantime.example";
const CONFIG_KEY = "api_config";

interface ApiConfig {
  baseUrl: string;
}

async function apiBase(): Promise<string> {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  return (stored[CONFIG_KEY] as ApiConfig | undefined)?.baseUrl ?? DEFAULT_API_BASE;
}

async function identity(): Promise<Identity | null> {
  const stored = await chrome.storage.local.get("identity");
  return (stored["identity"] as Identity | undefined) ?? null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown; compress?: boolean } = {},
): Promise<T> {
  const base = await apiBase();
  const id = await identity();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (id?.accessToken) headers.set("Authorization", `Bearer ${id.accessToken}`);

  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    let payload = JSON.stringify(init.json);
    if (init.compress && payload.length > 1024 && typeof CompressionStream !== "undefined") {
      const stream = new Blob([payload])
        .stream()
        .pipeThrough(new CompressionStream("deflate"));
      body = await new Response(stream).blob();
      headers.set("Content-Encoding", "deflate");
      headers.set("Content-Type", "application/json");
    } else {
      body = payload;
      headers.set("Content-Type", "application/json");
    }
  }

  const res = await fetch(`${base}${path}`, { ...init, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
