import path from 'node:path';

function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

const DEFAULT_PINNODDS_BASE = 'https://pinnodds.com';

function ms(v: string | undefined, fallback: number): number {
  return Math.max(0, num(v, fallback));
}

/**
 * Centralized environment loading. All secrets come from process.env only.
 */
export const env = {
  pinnacle: {
    /** Full SSE URL, or leave empty to build from apiBase + apiKey + PINNACLE_SSE_PATH */
    sseUrl: process.env.PINNACLE_SSE_URL ?? '',
    /** Live: odds-drop | Prematch: odds-drop-prematch */
    ssePath: process.env.PINNACLE_SSE_PATH ?? 'odds-drop',
    /** Odds-drop invite `token` (see shared link). Use with PINNACLE_API_KEY — stream often needs both. */
    sseAuthToken: process.env.PINNACLE_SSE_AUTH_TOKEN ?? '',
    /** REST host; default pinnodds.com */
    apiBase: process.env.PINNACLE_API_BASE ?? DEFAULT_PINNODDS_BASE,
    /** Trial / no-SSE: poll GET /api/drops on an interval */
    useDropsPoll: envBool(process.env.PINNACLE_USE_DROPS_POLL),
    /** Min 30s to avoid accidental quota burn */
    dropsPollMs: Math.max(30_000, num(process.env.PINNACLE_DROPS_POLL_MS, 900_000)),
    dropsMode: process.env.PINNACLE_DROPS_MODE ?? 'live',
    dropsLimit: Math.min(
      500,
      Math.max(1, num(process.env.PINNACLE_DROPS_LIMIT, 100)),
    ),
    dropsMinDropPct: process.env.PINNACLE_DROPS_MIN_DROP_PCT ?? '',
    dropsMaxAgeSec: Math.max(0, num(process.env.PINNACLE_DROPS_MAX_AGE_SEC, 600)),
    /** Caps parallel /kit/v1/details calls (trial quotas are very tight). */
    detailsMaxConcurrent: Math.max(
      1,
      num(process.env.PINNACLE_DETAILS_MAX_CONCURRENT, 2),
    ),
    apiKey: process.env.PINNACLE_API_KEY ?? '',
    /**
     * When the feed exposes `nvp` on totals/team_total drops, skip /kit/v1/details for dewag (saves quotas).
     * Set PINNACLE_PREFER_PROVIDER_NVP=false to always fetch two-way totals and recompute NVP locally.
     */
    preferProviderNvp: process.env.PINNACLE_PREFER_PROVIDER_NVP !== 'false',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    chatId: process.env.TELEGRAM_CHAT_ID ?? '',
    /** Space out sendMessage when many alerts fire at once (limits burst + API). */
    minGapMs: ms(process.env.TELEGRAM_MIN_GAP_MS, 300),
    /**
     * Prevent “minutes late” alert bursts: if Telegram send queue is already behind by more than this, drop new alerts.
     * 0 = disable (always queue).
     */
    maxQueueMs: ms(process.env.TELEGRAM_MAX_QUEUE_MS, 15_000),
    /**
     * Suppress repeat alerts with the same game/market fingerprint within this window (ms).
     * 0 = disable. Helps when SSE fires many correlated drops; mock SportyBet also exaggerates repeated edge.
     */
    dedupeWindowMs: ms(process.env.TELEGRAM_ALERT_DEDUPE_MS, 90_000),
  },
  http: {
    maxRetries: num(process.env.HTTP_MAX_RETRIES, 3),
    retryBaseMs: num(process.env.HTTP_RETRY_BASE_MS, 100),
  },
  server: {
    port: num(process.env.PORT, 3000),
    host: process.env.HOST ?? '0.0.0.0',
  },
  logging: {
    level: process.env.LOG_LEVEL ?? 'info',
    dir: process.env.LOG_DIR
      ? path.resolve(process.cwd(), process.env.LOG_DIR)
      : path.resolve(process.cwd(), 'logs'),
  },
};

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** Detect placeholder URL from .env.example. */
export function sseUrlLooksLikePlaceholder(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes('example.com') || u.includes('your-sse-provider');
}

/** For logs only — which query params are present (no secret values). */
export function pinnacleSseQueryAuthShape(urlStr: string): {
  hasKey: boolean;
  hasToken: boolean;
} {
  try {
    const u = new URL(urlStr);
    return {
      hasKey: u.searchParams.has('key'),
      hasToken: u.searchParams.has('token'),
    };
  } catch {
    return { hasKey: false, hasToken: false };
  }
}

/** Redact secrets when logging URLs that use ?key= or ?token=. */
export function redactPinnacleUrl(url: string): string {
  return url
    .replace(/([?&]key=)[^&]+/gi, '$1***')
    .replace(/([?&]token=)[^&]+/gi, '$1***');
}

/**
 * PinnOdds SSE: https://pinnodds.com/odds-drop (or prematch).
 * Their Node sample uses `?key=` on the URL; some SSE paths ignore custom headers, so we send
 * **both** `?key=` and `x-portal-apikey` when using `PINNACLE_API_KEY`.
 * `PINNACLE_SSE_AUTH_TOKEN` is the odds-drop **invite token** (same value as in `?token=` on the
 * link PinnOdds shares). For many accounts, `/odds-drop` needs **both** `token` and `key` on the URL.
 */
export function getPinnacleSseConnectOptions():
  | { url: string; headers: Record<string, string> }
  | null {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  };

  const configured = env.pinnacle.sseUrl.trim();
  if (configured && !sseUrlLooksLikePlaceholder(configured)) {
    const k = env.pinnacle.apiKey.trim();
    const tok = env.pinnacle.sseAuthToken.trim();
    let url = configured;
    try {
      const u = new URL(configured);
      if (k) {
        headers['x-portal-apikey'] = k;
        if (!u.searchParams.has('key')) {
          u.searchParams.set('key', k);
        }
      }
      if (tok && !u.searchParams.has('token')) {
        u.searchParams.set('token', tok);
      }
      url = u.toString();
    } catch {
      if (k) {
        headers['x-portal-apikey'] = k;
      }
    }
    return { url, headers };
  }

  const base = trimTrailingSlash(
    env.pinnacle.apiBase.trim() || DEFAULT_PINNODDS_BASE,
  );
  const ssePathSegment = (env.pinnacle.ssePath || 'odds-drop')
    .trim()
    .replace(/^\/+/, '');
  const key = env.pinnacle.apiKey.trim();
  const token = env.pinnacle.sseAuthToken.trim();

  if (key) {
    headers['x-portal-apikey'] = key;
    const u = new URL(`${base}/${ssePathSegment}`);
    u.searchParams.set('key', key);
    if (token) {
      u.searchParams.set('token', token);
    }
    return { url: u.toString(), headers };
  }
  if (token) {
    return {
      url: `${base}/${ssePathSegment}?token=${encodeURIComponent(token)}`,
      headers,
    };
  }
  return null;
}

export function canStartPinnacleSse(): boolean {
  return getPinnacleSseConnectOptions() !== null;
}

export function validateRequiredAtRuntime(): string[] {
  const missing: string[] = [];
  const key = env.pinnacle.apiKey.trim();
  if (!key) missing.push('PINNACLE_API_KEY');
  if (!key) return missing;

  if (env.pinnacle.useDropsPoll) {
    return missing;
  }

  if (!getPinnacleSseConnectOptions()) {
    missing.push(
      'Enable PINNACLE_USE_DROPS_POLL=true on trial, or use a paid SSE-enabled key / PINNACLE_SSE_URL',
    );
  }
  return missing;
}
