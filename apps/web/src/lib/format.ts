import { MICRO_DOLLARS_PER_USD } from "@meantime/shared";

export function formatMicro(micro: number): string {
  return `$${(micro / MICRO_DOLLARS_PER_USD).toFixed(4)}`;
}

export function formatMicroCents(micro: number): string {
  return `$${(micro / MICRO_DOLLARS_PER_USD).toFixed(2)}`;
}

export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
