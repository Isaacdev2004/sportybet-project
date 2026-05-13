import { executionEnv, sportyBetHomeUrl } from '../../config/executionEnv.js';
import { logger } from '../../utils/logger.js';
import { sportyBetApiRequest } from './api/sessionTransport.js';
import { extractByDotPath } from './api/responseExtract.js';
import {
  appendActivityEvent,
  appendBalanceActivityIfDue,
} from '../../state/activityEventStore.js';

export interface AccountBalanceSnapshot {
  accountId: string;
  balance: number | null;
  currency: string;
  atMs: number;
  source: string;
  error?: string;
}

const cache = new Map<string, { atMs: number; snap: AccountBalanceSnapshot }>();
const lastBalanceErrorLog = new Map<string, number>();

function apiBase(): string {
  const a = executionEnv.sportyBetApiBaseUrl.trim();
  if (a) return a.replace(/\/+$/, '');
  return executionEnv.sportyBetBaseUrl.trim().replace(/\/+$/, '');
}

function resolveBalanceUrl(): string | undefined {
  const p = executionEnv.sportyBetBalancePath;
  if (!p) return undefined;
  if (/^https?:\/\//i.test(p)) return p;
  return `${apiBase()}${p.startsWith('/') ? p : `/${p}`}`;
}

function parseMoney(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

function scrapeBalanceFromHtml(html: string): number | undefined {
  const patterns: RegExp[] = [
    /"userBalance"\s*:\s*([\d.,]+)/i,
    /"walletBalance"\s*:\s*([\d.,]+)/i,
    /"balance"\s*:\s*([\d.,]+)/i,
    /"availableBalance"\s*:\s*([\d.,]+)/i,
    /data-balance\s*=\s*"([\d.,]+)"/i,
    /₦\s*([\d,]+(?:\.\d+)?)/,
    /NGN\s*([\d,]+(?:\.\d+)?)/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const n = parseMoney(m[1]);
      if (n != null) return n;
    }
  }
  return undefined;
}

async function fetchBalanceForAccount(accountId: string): Promise<AccountBalanceSnapshot> {
  const atMs = Date.now();
  const urlConfigured = resolveBalanceUrl();

  try {
    if (urlConfigured) {
      const res = await sportyBetApiRequest({ url: urlConfigured, accountId, method: 'GET' });
      if (!res.ok) {
        return {
          accountId,
          balance: null,
          currency: 'NGN',
          atMs,
          source: 'api',
          error: `http_${res.status}`,
        };
      }
      const path = executionEnv.sportyBetBalanceJsonPath.trim();
      let raw: unknown = res.body;
      if (path) {
        raw = extractByDotPath(res.body, path);
      }
      const n = parseMoney(raw);
      if (n != null) {
        return { accountId, balance: n, currency: 'NGN', atMs, source: 'api_json' };
      }
      const bodyStr =
        typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
      const fromStr = scrapeBalanceFromHtml(bodyStr);
      if (fromStr != null) {
        return { accountId, balance: fromStr, currency: 'NGN', atMs, source: 'api_scan' };
      }
      return {
        accountId,
        balance: null,
        currency: 'NGN',
        atMs,
        source: 'api',
        error: 'unparseable_balance',
      };
    }

    if (!executionEnv.sportyBetBalanceHtmlScrape) {
      return {
        accountId,
        balance: null,
        currency: 'NGN',
        atMs,
        source: 'off',
        error: 'no_balance_path',
      };
    }

    const home = sportyBetHomeUrl();
    const res = await sportyBetApiRequest({ url: home, accountId, method: 'GET' });
    if (!res.ok) {
      return {
        accountId,
        balance: null,
        currency: 'NGN',
        atMs,
        source: 'html',
        error: `http_${res.status}`,
      };
    }
    const html = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    const n = scrapeBalanceFromHtml(html);
    if (n != null) {
      return { accountId, balance: n, currency: 'NGN', atMs, source: 'html_scrape' };
    }
    return {
      accountId,
      balance: null,
      currency: 'NGN',
      atMs,
      source: 'html',
      error: 'balance_not_found_in_html',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.debug('[balance] probe failed', { accountId, err: msg });
    return {
      accountId,
      balance: null,
      currency: 'NGN',
      atMs,
      source: 'error',
      error: msg,
    };
  }
}

export async function getSportyBetBalanceSnapshot(
  accountId: string,
  maxAgeMs = 25_000,
): Promise<AccountBalanceSnapshot> {
  const now = Date.now();
  const hit = cache.get(accountId);
  if (hit && now - hit.atMs < maxAgeMs) {
    return hit.snap;
  }
  const snap = await fetchBalanceForAccount(accountId);
  cache.set(accountId, { atMs: now, snap });

  if (snap.error) {
    const le = lastBalanceErrorLog.get(accountId) ?? 0;
    if (now - le > 300_000) {
      lastBalanceErrorLog.set(accountId, now);
      appendActivityEvent({
        source: 'balance',
        level: 'warn',
        accountId,
        headline: 'Balance probe failed',
        detail: `${snap.error} (${snap.source})`,
      });
    }
  } else if (snap.balance != null) {
    const bal = snap.balance;
    appendBalanceActivityIfDue(accountId, executionEnv.sportyBetBalanceActivityLogMs, () => ({
      source: 'balance',
      level: 'ok',
      accountId,
      headline: 'Balance updated',
      detail: `Live wallet ≈ ₦${bal.toLocaleString('en-NG', { maximumFractionDigits: 2 })} (${snap.source})`,
    }));
  }

  return snap;
}

export async function getSportyBetBalancesForAccounts(
  accountIds: string[],
  maxAgeMs = 25_000,
): Promise<Record<string, AccountBalanceSnapshot>> {
  const out: Record<string, AccountBalanceSnapshot> = {};
  const ids = accountIds.filter(Boolean).slice(0, 12);
  await Promise.all(
    ids.map(async (id) => {
      out[id] = await getSportyBetBalanceSnapshot(id, maxAgeMs);
    }),
  );
  return out;
}
