export const RETRY_DELAY_MS = 2_000;
export const RETRY_DELAY_MAX_MS = 10_000;

export type Sleep = (ms: number) => Promise<void>;

export const sleep: Sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function retryDelayMs(retryAfter: string | null, now: number = Date.now()): number {
  const header = (retryAfter ?? "").trim();
  if (!header) return RETRY_DELAY_MS;
  const seconds = /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - now) / 1000;
  if (!Number.isFinite(seconds)) return RETRY_DELAY_MS;
  return Math.min(RETRY_DELAY_MAX_MS, Math.max(0, Math.round(seconds * 1000)));
}
