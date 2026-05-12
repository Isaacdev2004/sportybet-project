import fs from 'node:fs';

import type { APIRequestContext, BrowserContext } from 'playwright';

import { getAccounts } from '../../../account/accountManager.js';
import { executionEnv } from '../../../config/executionEnv.js';
import { getOrCreateContext, sessionStoragePath } from '../../../execution/playwrightManager.js';
import { parseProxy } from '../../../account/proxyManager.js';
import { runSerial } from '../../../utils/serialQueue.js';
import { logger } from '../../../utils/logger.js';

export interface SportyBetApiHttpResult {
  ok: boolean;
  status: number;
  url: string;
  body: unknown;
  via: 'playwright' | 'fetch';
}

const API_HTTP_QUEUE = 'sportybet:api_http';
const inFlightRequests = new Map<string, Promise<SportyBetApiHttpResult>>();

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

function buildHeaders(targetUrl: string, accountId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': executionEnv.sportyBetApiUserAgent,
    Referer: executionEnv.sportyBetBaseUrl,
  };
  const token = executionEnv.sportyBetApiAuthToken.trim();
  if (token) {
    headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }
  if (accountId) {
    const cookie = cookiesHeaderForUrl(sessionStoragePath(accountId), targetUrl);
    if (cookie) headers.Cookie = cookie;
  }
  return headers;
}

async function parsePlaywrightBody(res: {
  text(): Promise<string>;
  headers(): Record<string, string>;
}): Promise<unknown> {
  const txt = await res.text();
  const ct = (res.headers()['content-type'] ?? '').toLowerCase();
  if (ct.includes('json') || txt.trim().startsWith('{') || txt.trim().startsWith('[')) {
    try {
      return JSON.parse(txt) as unknown;
    } catch {
      return txt;
    }
  }
  return txt;
}

async function parseFetchBody(res: globalThis.Response): Promise<unknown> {
  const txt = await res.text();
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  if (ct.includes('json') || txt.trim().startsWith('{') || txt.trim().startsWith('[')) {
    try {
      return JSON.parse(txt) as unknown;
    } catch {
      return txt;
    }
  }
  return txt;
}

async function requestViaPlaywright(
  ctx: BrowserContext,
  url: string,
  method: string,
): Promise<SportyBetApiHttpResult> {
  const api: APIRequestContext = ctx.request;
  const res =
    method === 'POST'
      ? await api.post(url, { timeout: executionEnv.sportyBetApiTimeoutMs, failOnStatusCode: false })
      : await api.get(url, { timeout: executionEnv.sportyBetApiTimeoutMs, failOnStatusCode: false });
  const body = await parsePlaywrightBody(res);
  return {
    ok: res.ok(),
    status: res.status(),
    url,
    body,
    via: 'playwright',
  };
}

async function requestViaFetch(
  url: string,
  method: string,
  accountId?: string,
): Promise<SportyBetApiHttpResult> {
  const headers = buildHeaders(url, accountId);
  const res = await fetch(url, {
    method,
    headers,
    signal: AbortSignal.timeout(executionEnv.sportyBetApiTimeoutMs),
  });
  const body = await parseFetchBody(res);
  return {
    ok: res.ok,
    status: res.status,
    url,
    body,
    via: 'fetch',
  };
}

function shouldRetryWithPlaywright(result: SportyBetApiHttpResult): boolean {
  return result.status === 401 || result.status === 403;
}

async function dispatchRequest(
  url: string,
  method: string,
  accountId?: string,
): Promise<SportyBetApiHttpResult> {
  const resolvedAccountId =
    accountId ?? getAccounts().find((a) => a.enabled !== false)?.id;
  const headers = resolvedAccountId ? buildHeaders(url, resolvedAccountId) : undefined;
  const hasSessionCookies = Boolean(headers?.Cookie);

  if (hasSessionCookies) {
    try {
      const fetched = await requestViaFetch(url, method, resolvedAccountId);
      if (fetched.ok || !executionEnv.sportyBetApiUsePlaywrightTransport) {
        return fetched;
      }
      if (!shouldRetryWithPlaywright(fetched)) {
        return fetched;
      }
    } catch (e) {
      logger.debug('[sportybet-api] fetch transport failed', {
        err: e instanceof Error ? e.message : String(e),
        url,
      });
    }
  }

  if (resolvedAccountId && executionEnv.sportyBetApiUsePlaywrightTransport) {
    try {
      const account = getAccounts().find((a) => a.id === resolvedAccountId);
      if (account) {
        const ctx = await getOrCreateContext({
          accountId: resolvedAccountId,
          workerSlot: executionEnv.sportyBetApiWorkerSlot,
          proxy: parseProxy(account.proxy),
          headless: executionEnv.headless,
        });
        return await requestViaPlaywright(ctx, url, method);
      }
    } catch (e) {
      logger.warn('[sportybet-api] playwright transport failed — fetch fallback', {
        err: e instanceof Error ? e.message : String(e),
        url,
      });
    }
  }

  return requestViaFetch(url, method, resolvedAccountId);
}

/** Authenticated GET/POST using saved session cookies (serialized; fetch first when cookies exist). */
export async function sportyBetApiRequest(params: {
  url: string;
  method?: 'GET' | 'POST';
  accountId?: string;
}): Promise<SportyBetApiHttpResult> {
  const method = params.method ?? 'GET';
  const dedupeKey = `${method}:${params.url}`;
  const pending = inFlightRequests.get(dedupeKey);
  if (pending) return pending;

  const work = runSerial(API_HTTP_QUEUE, () =>
    dispatchRequest(params.url, method, params.accountId),
  ).finally(() => {
    inFlightRequests.delete(dedupeKey);
  });
  inFlightRequests.set(dedupeKey, work);
  return work;
}
