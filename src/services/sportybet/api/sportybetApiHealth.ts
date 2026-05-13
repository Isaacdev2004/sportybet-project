import fs from 'node:fs';

import { getAccounts } from '../../../account/accountManager.js';
import { executionEnv } from '../../../config/executionEnv.js';
import { sessionStoragePath } from '../../../execution/playwrightManager.js';

export interface SportyBetApiHealthResult {
  ok: boolean;
  checkedAtMs: number;
  latencyMs: number;
  status: number;
  accountId?: string;
  url: string;
  error?: string;
  /** True when no session file or no cookies — API may 401 until login. */
  sessionMissing?: boolean;
}

function cookiesHeaderForUrl(storagePath: string, targetUrl: string): string | undefined {
  if (!fs.existsSync(storagePath)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(storagePath, 'utf8')) as {
      cookies?: Array<{ name: string; value: string; domain?: string }>;
    };
    const host = new URL(targetUrl).hostname.toLowerCase();
    const parts = host.split('.');
    const registrable = parts.length >= 2 ? parts.slice(-2).join('.') : host;
    const cookies = (raw.cookies ?? []).filter((c) => {
      const d = (c.domain ?? '').toLowerCase().replace(/^\./, '');
      return d === host || d.endsWith(registrable) || host.endsWith(d);
    });
    if (cookies.length === 0) return undefined;
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return undefined;
  }
}

function apiBaseUrl(): string {
  return executionEnv.sportyBetApiBaseUrl.trim() || executionEnv.sportyBetBaseUrl.trim();
}

/** Lightweight factsCenter list call (basketball vertical) — validates session + WAF token. */
export async function probeSportyBetApiHealth(
  accountId?: string,
  timeoutMs = 12_000,
): Promise<SportyBetApiHealthResult> {
  const base = apiBaseUrl().replace(/\/$/, '');
  const url = `${base}/api/ng/factsCenter/liveOrPrematchEvents?sportId=sr%3Asport%3A2`;
  const id =
    accountId?.trim() ||
    getAccounts().find((a) => a.enabled !== false)?.id ||
    getAccounts()[0]?.id;
  const checkedAtMs = Date.now();
  if (!id) {
    return {
      ok: false,
      checkedAtMs,
      latencyMs: 0,
      status: 0,
      url,
      error: 'no_account',
      sessionMissing: true,
    };
  }
  const cookie = cookiesHeaderForUrl(sessionStoragePath(id), url);
  if (!cookie) {
    return {
      ok: false,
      checkedAtMs,
      latencyMs: 0,
      status: 0,
      accountId: id,
      url,
      error: 'no_session_cookies',
      sessionMissing: true,
    };
  }
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': executionEnv.sportyBetApiUserAgent,
        Referer: executionEnv.sportyBetBaseUrl,
        Cookie: cookie,
      },
      signal: AbortSignal.timeout(Math.max(3_000, timeoutMs)),
    });
    const latencyMs = Date.now() - t0;
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        checkedAtMs,
        latencyMs,
        status: res.status,
        accountId: id,
        url,
        error: 'auth_or_waf',
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        checkedAtMs,
        latencyMs,
        status: res.status,
        accountId: id,
        url,
        error: `http_${res.status}`,
      };
    }
    return {
      ok: true,
      checkedAtMs,
      latencyMs,
      status: res.status,
      accountId: id,
      url,
    };
  } catch (e) {
    return {
      ok: false,
      checkedAtMs,
      latencyMs: Date.now() - t0,
      status: 0,
      accountId: id,
      url,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

let healthCache: { atMs: number; result: SportyBetApiHealthResult } | null = null;

export async function getSportyBetApiHealthCached(maxAgeMs = 45_000): Promise<SportyBetApiHealthResult> {
  const now = Date.now();
  if (healthCache && now - healthCache.atMs < maxAgeMs) {
    return healthCache.result;
  }
  const result = await probeSportyBetApiHealth();
  healthCache = { atMs: now, result };
  return result;
}
