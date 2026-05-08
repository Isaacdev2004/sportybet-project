/**
 * Live match list cache: batched DOM read, multi-key index, stable row refs,
 * TTL, row-count invalidation, half-TTL refresh, pre-warm after Live navigation.
 */
import type { Locator, Page } from 'playwright';

import type { SportyBetMarketKey } from './types.js';
import type { ExecutionBudget } from '../risk/riskManager.js';
import {
  canonicalPairKey,
  normalizeName,
  rowMatchesParticipants,
  secondaryPairJoinKey,
} from './nameNormalize.js';
import { logger } from '../utils/logger.js';

export interface RowStableRef {
  attr: string;
  value: string;
}

export interface LiveMatchCacheSnapshot {
  scopeId: string;
  url: string;
  rowSel: string;
  sportLabel: string;
  builtAtMs: number;
  ttlMs: number;
  rowCount: number;
  /** Primary + secondary + blob + stable keys → row index */
  keyToIndex: Map<string, number>;
  /** textContent snapshot per row */
  textByIndex: string[];
  /** Stable attribute locator per row (optional); empty = use nth only */
  stableByIndex: (RowStableRef | null)[];
  halfRefreshTimer?: ReturnType<typeof setTimeout>;
}

function ttlMs(): number {
  const raw = process.env.EXECUTION_MATCH_CACHE_TTL_MS;
  const n = raw !== undefined && raw !== '' ? Number(raw) : 45_000;
  if (!Number.isFinite(n)) return 45_000;
  return Math.min(60_000, Math.max(30_000, n));
}

function stableAttrCandidates(): string[] {
  const raw =
    process.env.EXECUTION_LIVE_ROW_STABLE_ATTRS ?? 'data-event-id,data-id,data-testid,id';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function scopeId(page: Page, sportLabel: string, rowSel: string): string {
  return `${page.url()}|${sportLabel}|${rowSel}`;
}

function indexKeysFromRowText(
  raw: string,
  stable: RowStableRef | null,
): string[] {
  const keys = new Set<string>();
  const blob = normalizeName(raw);
  if (blob) keys.add(`blob:${blob}`);

  const parts = raw.split(/\s+(?:vs\.?|v\.?)[\s]*|[-–—]+\s+/i);
  if (parts.length >= 2) {
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    const a = normalizeName(first);
    const b = normalizeName(last);
    if (a && b) {
      keys.add(canonicalPairKey(first, last));
      keys.add(secondaryPairJoinKey(first, last));
    }
  }

  if (stable) {
    keys.add(`stable:${stable.attr}=${stable.value}`);
  }

  return [...keys];
}

const cacheByPage = new WeakMap<Page, LiveMatchCacheSnapshot>();

export function invalidateMatchCache(page: Page): void {
  const s = cacheByPage.get(page);
  if (s?.halfRefreshTimer) clearTimeout(s.halfRefreshTimer);
  cacheByPage.delete(page);
}

interface RowProbe {
  text: string;
  stable: RowStableRef | null;
}

async function batchReadRows(
  page: Page,
  rowSel: string,
  maxRows: number,
): Promise<RowProbe[]> {
  const attrs = stableAttrCandidates();
  return page.evaluate(
    ({ sel, max, attrList }) => {
      const list = document.querySelectorAll(sel);
      const n = Math.min(list.length, max);
      const out: { text: string; stable: { attr: string; value: string } | null }[] = [];
      for (let i = 0; i < n; i++) {
        const el = list[i]!;
        const text = (el.textContent ?? '').slice(0, 2000);
        let stable: { attr: string; value: string } | null = null;
        for (const a of attrList) {
          let v = el.getAttribute(a);
          if (!v) {
            const inner = el.querySelector(`[${a}]`);
            v = inner?.getAttribute(a) ?? null;
          }
          if (v) {
            stable = { attr: a, value: v };
            break;
          }
        }
        out.push({ text, stable });
      }
      return out;
    },
    { sel: rowSel, max: maxRows, attrList: attrs },
  );
}

async function countRows(page: Page, rowSel: string): Promise<number> {
  return page.evaluate((sel) => document.querySelectorAll(sel).length, rowSel);
}

function buildKeyMap(rows: RowProbe[]): Map<string, number> {
  const keyToIndex = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!.text;
    const stable = rows[i]!.stable;
    for (const k of indexKeysFromRowText(raw, stable)) {
      if (!keyToIndex.has(k)) keyToIndex.set(k, i);
    }
  }
  return keyToIndex;
}

async function rebuildCacheLocked(
  page: Page,
  rowSel: string,
  maxRows: number,
  sportLabel: string,
  ttl: number,
): Promise<void> {
  const rows = await batchReadRows(page, rowSel, maxRows);
  const texts = rows.map((r) => r.text);
  const stableByIndex = rows.map((r) => r.stable);
  const keyToIndex = buildKeyMap(rows);
  const sid = scopeId(page, sportLabel, rowSel);
  const prev = cacheByPage.get(page);
  if (prev?.halfRefreshTimer) clearTimeout(prev.halfRefreshTimer);

  const snapshot: LiveMatchCacheSnapshot = {
    scopeId: sid,
    url: page.url(),
    rowSel,
    sportLabel,
    builtAtMs: Date.now(),
    ttlMs: ttl,
    rowCount: rows.length,
    keyToIndex,
    textByIndex: texts,
    stableByIndex,
  };

  cacheByPage.set(page, snapshot);
  scheduleHalfTtlRefresh(page, rowSel, maxRows, sportLabel, ttl);
}

function scheduleHalfTtlRefresh(
  page: Page,
  rowSel: string,
  maxRows: number,
  sportLabel: string,
  ttl: number,
): void {
  const delay = Math.floor(Math.min(ttl / 2, 30_000));
  if (delay < 1500) return;

  const snap = cacheByPage.get(page);
  if (!snap) return;

  if (snap.halfRefreshTimer) clearTimeout(snap.halfRefreshTimer);

  snap.halfRefreshTimer = setTimeout(() => {
    void (async () => {
      try {
        if (page.isClosed()) return;
        if (scopeId(page, sportLabel, rowSel) !== snap.scopeId) return;
        await rebuildCacheLocked(page, rowSel, maxRows, sportLabel, ttl);
        logger.debug('[nav] match cache background refresh done', {
          url: page.url().slice(0, 80),
        });
      } catch {
        /* ignore */
      }
    })();
  }, delay);
}

function cacheValid(s: LiveMatchCacheSnapshot): boolean {
  return Date.now() - s.builtAtMs < s.ttlMs;
}

function rowLocator(
  page: Page,
  rowSel: string,
  idx: number,
  stable: RowStableRef | null,
): Locator {
  if (stable) {
    const inner = `[${stable.attr}=${JSON.stringify(stable.value)}]`;
    return page.locator(rowSel).filter({ has: page.locator(inner) }).first();
  }
  return page.locator(rowSel).nth(idx);
}

async function ensureRowCountOrRebuild(
  page: Page,
  snap: LiveMatchCacheSnapshot | undefined,
  rowSel: string,
  maxRows: number,
  sportLabel: string,
  ttl: number,
): Promise<LiveMatchCacheSnapshot | undefined> {
  if (!snap || !cacheValid(snap)) return snap;
  const liveCount = await countRows(page, rowSel);
  if (liveCount !== snap.rowCount) {
    logger.debug('[nav] match cache row count changed — rebuild', {
      before: snap.rowCount,
      after: liveCount,
    });
    await rebuildCacheLocked(page, rowSel, maxRows, sportLabel, ttl);
    return cacheByPage.get(page);
  }
  return snap;
}

/**
 * Pre-warm cache right after Sport → Live navigation (no signal yet).
 * Match-discovery only; does not change click sequence.
 */
export async function preloadLiveMatchCache(
  page: Page,
  sportLabel: string,
  budget: ExecutionBudget,
  rowSel: string,
  waitList: string,
  maxRows: number,
): Promise<void> {
  budget.assertWithin();
  await page
    .waitForSelector(waitList, {
      timeout: Math.min(8000, budget.remainingMs()),
      state: 'visible',
    })
    .catch(() => {});
  await rebuildCacheLocked(page, rowSel, maxRows, sportLabel, ttlMs());
  logger.debug('[nav] match cache pre-warmed', { sportLabel, rowSel: rowSel.slice(0, 60) });
}

/**
 * Returns a row locator: cache-first; O(1) keys; stable :has() locator when available.
 */
export async function findMatchRowCached(
  page: Page,
  key: SportyBetMarketKey,
  budget: ExecutionBudget,
  rowSel: string,
  waitList: string,
  maxRows: number,
  sportLabel: string,
): Promise<Locator | null> {
  budget.assertWithin();
  const ttl = ttlMs();
  const sid = scopeId(page, sportLabel, rowSel);

  await page
    .waitForSelector(waitList, {
      timeout: Math.min(8000, budget.remainingMs()),
      state: 'visible',
    })
    .catch(() => {});

  let snap = cacheByPage.get(page);
  snap = await ensureRowCountOrRebuild(page, snap, rowSel, maxRows, sportLabel, ttl);

  const needsRebuild =
    !snap ||
    snap.scopeId !== sid ||
    !cacheValid(snap) ||
    snap.textByIndex.length === 0;

  if (needsRebuild) {
    await rebuildCacheLocked(page, rowSel, maxRows, sportLabel, ttl);
    snap = cacheByPage.get(page);
  }

  if (!snap) return null;

  const tLookup = Date.now();

  const pairKey = canonicalPairKey(key.home, key.away);
  const joinKey = secondaryPairJoinKey(key.home, key.away);
  const blobKey = `blob:${normalizeName([key.home, key.away].join(' '))}`;

  let idx =
    snap.keyToIndex.get(pairKey) ??
    snap.keyToIndex.get(joinKey) ??
    snap.keyToIndex.get(blobKey);

  if (idx !== undefined) {
    const loc = rowLocator(page, rowSel, idx, snap.stableByIndex[idx] ?? null);
    logger.debug('[nav] findMatch O(1) cache', {
      ms: Date.now() - tLookup,
      keys: [pairKey.slice(0, 40), joinKey.slice(0, 40)],
    });
    return loc;
  }

  for (let i = 0; i < snap.textByIndex.length; i++) {
    budget.assertWithin();
    const raw = snap.textByIndex[i]!;
    if (rowMatchesParticipants(key.home, key.away, raw)) {
      logger.debug('[nav] findMatch fuzzy snapshot', { i, ms: Date.now() - tLookup });
      return rowLocator(page, rowSel, i, snap.stableByIndex[i] ?? null);
    }
  }

  if (cacheValid(snap)) {
    logger.warn('[nav] findMatch — miss, forcing refresh', {
      home: key.home,
      away: key.away,
    });
    await rebuildCacheLocked(page, rowSel, maxRows, sportLabel, ttl);
    const snap2 = cacheByPage.get(page);
    if (!snap2) return null;

    let idx2 =
      snap2.keyToIndex.get(pairKey) ??
      snap2.keyToIndex.get(joinKey) ??
      snap2.keyToIndex.get(blobKey);
    if (idx2 !== undefined) {
      return rowLocator(page, rowSel, idx2, snap2.stableByIndex[idx2] ?? null);
    }

    for (let i = 0; i < snap2.textByIndex.length; i++) {
      budget.assertWithin();
      if (rowMatchesParticipants(key.home, key.away, snap2.textByIndex[i]!)) {
        return rowLocator(page, rowSel, i, snap2.stableByIndex[i] ?? null);
      }
    }
  }

  logger.warn('[nav] findMatch — no row matched fixture', {
    home: key.home,
    away: key.away,
  });
  return null;
}
