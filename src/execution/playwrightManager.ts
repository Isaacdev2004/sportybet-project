import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { executionEnv, sportyBetHomeUrl } from '../config/executionEnv.js';
import { logger } from '../utils/logger.js';
import { attachSportyBetApiCapture } from '../services/sportybet/api/pageCapture.js';
import type { ProxySettings } from '../account/types.js';
import { runSerial } from '../utils/serialQueue.js';

let sharedBrowser: Browser | null = null;

/** Stable key: `${accountId}::ws${slot}` — one context + tab per worker slot. */
export function sessionKeyForWorker(accountId: string, workerSlot: number): string {
  return `${accountId}::ws${workerSlot}`;
}

const contextBySession = new Map<string, BrowserContext>();
const sessionPageBySession = new Map<string, Page>();
const keepaliveTimers = new Map<string, ReturnType<typeof setInterval>>();

async function disposeSessionPage(sessionKey: string): Promise<void> {
  const p = sessionPageBySession.get(sessionKey);
  if (!p) return;
  sessionPageBySession.delete(sessionKey);
  await p.close().catch(() => {});
}

/**
 * Returns a stable page for this session (account + worker slot).
 */
export async function getOrCreateSessionPage(
  sessionKey: string,
  ctx: BrowserContext,
): Promise<Page> {
  let p = sessionPageBySession.get(sessionKey);
  if (p && !p.isClosed()) {
    try {
      if (p.context() === ctx) return p;
    } catch {
      /* stale */
    }
  }
  if (p) sessionPageBySession.delete(sessionKey);
  p = await ctx.newPage();
  attachSportyBetApiCapture(p);
  sessionPageBySession.set(sessionKey, p);
  return p;
}

async function ensureBrowser(headless: boolean): Promise<Browser> {
  if (sharedBrowser?.isConnected()) {
    return sharedBrowser;
  }
  return runSerial('playwright:shared_browser', async () => {
    if (sharedBrowser?.isConnected()) {
      return sharedBrowser;
    }
    sharedBrowser = await chromium.launch({
      headless,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
    logger.info('[playwright] browser launched', { headless });
    return sharedBrowser;
  });
}

function ensureSessionDir(): void {
  try {
    fs.mkdirSync(executionEnv.sessionDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

export function sessionStoragePath(accountId: string): string {
  ensureSessionDir();
  return path.join(executionEnv.sessionDir, `${accountId}.json`);
}

function clearKeepalive(sessionKey: string): void {
  const t = keepaliveTimers.get(sessionKey);
  if (t) {
    clearInterval(t);
    keepaliveTimers.delete(sessionKey);
  }
}

/**
 * Session keepalive without opening a tab — uses the context cookie jar (same as browser).
 */
async function idlePingContext(ctx: BrowserContext): Promise<void> {
  const url = sportyBetHomeUrl();
  await ctx.request.get(url, {
    timeout: 14_000,
    failOnStatusCode: false,
  });
}

function ensureContextKeepalive(sessionKey: string, ctx: BrowserContext): void {
  const ms = executionEnv.sessionKeepaliveMs;
  if (ms <= 0) return;
  if (keepaliveTimers.has(sessionKey)) return;

  const id = setInterval(() => {
    void (async () => {
      const cur = contextBySession.get(sessionKey);
      if (!cur || cur !== ctx) return;
      const br = cur.browser();
      if (!br?.isConnected()) return;
      await idlePingContext(cur).catch((e: unknown) => {
        logger.debug('[playwright] keepalive ping skipped', {
          sessionKey,
          err: e instanceof Error ? e.message : String(e),
        });
      });
    })();
  }, ms);
  keepaliveTimers.set(sessionKey, id);
  logger.info('[playwright] keepalive scheduled', { sessionKey, intervalMs: ms });
}

async function contextLooksUsable(ctx: BrowserContext): Promise<boolean> {
  try {
    const br = ctx.browser();
    if (!br?.isConnected()) return false;
    await ctx.pages();
    return true;
  } catch {
    return false;
  }
}

/**
 * One **BrowserContext** per session key (proxy + cookies from shared storage file).
 * Single shared **Browser** process.
 * Serialized per session (`pwctx:${sessionKey}`) so two startups cannot race the same slot.
 */
export async function getOrCreateContext(params: {
  accountId: string;
  workerSlot?: number;
  proxy?: ProxySettings;
  headless: boolean;
  storageStatePath?: string;
}): Promise<BrowserContext> {
  const workerSlot = params.workerSlot ?? 0;
  const sessionKey = sessionKeyForWorker(params.accountId, workerSlot);

  return runSerial(`pwctx:${sessionKey}`, async () => {
    let ctx = contextBySession.get(sessionKey);
    if (ctx && !(await contextLooksUsable(ctx))) {
      await disposeSessionPage(sessionKey);
      await ctx.close().catch(() => {});
      contextBySession.delete(sessionKey);
      clearKeepalive(sessionKey);
      ctx = undefined;
    }

    if (ctx) {
      ensureContextKeepalive(sessionKey, ctx);
      return ctx;
    }

    const browser = await ensureBrowser(params.headless);
    const storage =
      params.storageStatePath ??
      (fs.existsSync(sessionStoragePath(params.accountId))
        ? sessionStoragePath(params.accountId)
        : undefined);

    ctx = await browser.newContext({
      proxy: params.proxy,
      storageState: storage,
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
    });
    contextBySession.set(sessionKey, ctx);
    ensureContextKeepalive(sessionKey, ctx);
    logger.info('[playwright] context created', {
      accountId: params.accountId,
      workerSlot,
      sessionKey,
    });
    return ctx;
  });
}

export async function saveStorageState(
  accountId: string,
  context: BrowserContext,
): Promise<void> {
  ensureSessionDir();
  const p = sessionStoragePath(accountId);
  await context.storageState({ path: p });
}

async function closeSessionByKey(sessionKey: string): Promise<void> {
  clearKeepalive(sessionKey);
  await disposeSessionPage(sessionKey);
  const ctx = contextBySession.get(sessionKey);
  if (ctx) {
    await ctx.close().catch(() => {});
    contextBySession.delete(sessionKey);
  }
}

/** Close one worker context or all worker contexts for this account. */
export async function closeContext(accountId: string, workerSlot?: number): Promise<void> {
  if (workerSlot !== undefined) {
    await closeSessionByKey(sessionKeyForWorker(accountId, workerSlot));
    return;
  }
  const prefix = `${accountId}::ws`;
  for (const k of [...contextBySession.keys()]) {
    if (k.startsWith(prefix)) {
      await closeSessionByKey(k);
    }
  }
}

export async function shutdownBrowser(): Promise<void> {
  const keys = [...contextBySession.keys()];
  for (const k of keys) {
    await closeSessionByKey(k);
  }
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

export function hasContext(accountId: string): boolean {
  const prefix = `${accountId}::ws`;
  for (const k of contextBySession.keys()) {
    if (k.startsWith(prefix)) return true;
  }
  return false;
}
