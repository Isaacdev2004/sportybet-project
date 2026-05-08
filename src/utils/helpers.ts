import { env } from '../config/env.js';
import { logger } from './logger.js';

/** Sleep helper for backoff without blocking timers globally. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff: base * 2^attempt with jitter */
export function backoffMs(attempt: number): number {
  const base = Math.max(0, env.http.retryBaseMs);
  const cap = 30_000;
  const pow = Math.min(cap, base * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 250);
  return pow + jitter;
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { maxRetries?: number; isRetryable?: (err: unknown) => boolean },
): Promise<T> {
  const max = opts?.maxRetries ?? env.http.maxRetries;
  let last: unknown;

  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const retryable =
        opts?.isRetryable?.(e) ??
        (e instanceof Error &&
          /fetch|network|ECONNRESET|ENOTFOUND|EAI_AGAIN|5\d\d|\b429\b|rate_limited/.test(
            e.message,
          ));

      if (attempt >= max || !retryable) {
        logger.warn(`[retry] ${label} failed permanently`, {
          attempt,
          err: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
      const baseWait = backoffMs(attempt);
      const wait =
        e instanceof Error && /\b429\b|rate_limited/i.test(e.message)
          ? Math.max(baseWait, 12_000)
          : baseWait;
      logger.debug(`[retry] ${label} attempt ${attempt + 1}/${max} in ${wait}ms`);
      await delay(wait);
    }
  }
  throw last;
}

/** Safe JSON parse for SSE lines */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Compare total lines from drop vs /details (handles 220.5 vs "220.5" vs float noise). */
export function totalLinesEquivalent(
  a: string | number | undefined,
  b: string | number | undefined,
): boolean {
  if (a === undefined || b === undefined) return false;
  if (String(a).trim() === String(b).trim()) return true;
  const na = typeof a === 'number' ? a : Number(String(a).trim());
  const nb = typeof b === 'number' ? b : Number(String(b).trim());
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    return Math.abs(na - nb) < 1e-6;
  }
  return false;
}

/** Coerce unknown to finite positive decimal odds */
export function toDecimalOdds(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n) && n > 1) return n;
  }
  return undefined;
}

export function pick<T extends object>(obj: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    if (k in obj) out[k] = obj[k];
  }
  return out;
}
