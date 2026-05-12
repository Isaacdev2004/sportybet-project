import { executionEnv } from '../../../config/executionEnv.js';
import { canonicalPairKey, rowMatchesParticipants } from '../../../execution/nameNormalize.js';
import type { OddsDropSignal } from '../../../types/index.js';
import { logger } from '../../../utils/logger.js';
import { sportyBetApiRequest } from './sessionTransport.js';

interface SportyBetEventRow {
  eventId: string;
  homeTeamName: string;
  awayTeamName: string;
}

interface CacheEntry {
  eventId: string;
  expiresAtMs: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | undefined>>();

function cacheTtlMs(): number {
  const raw = process.env.SPORTYBET_API_EVENT_CACHE_TTL_MS;
  if (raw === undefined || raw === '') return 90_000;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(5_000, Math.min(600_000, n)) : 90_000;
}

function apiBaseUrl(): string {
  return executionEnv.sportyBetApiBaseUrl.trim() || executionEnv.sportyBetBaseUrl.trim();
}

function pickStr(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export function isSportyBetEventId(id: string | undefined): boolean {
  if (!id?.trim()) return false;
  return /^sr:(match|season|stage):/i.test(id.trim());
}

/** Map feed sport labels to SportyBet `sr:sport:*` ids (NG factsCenter). */
export function sportyBetSportIdForSignal(signal: OddsDropSignal): string | undefined {
  const blob = `${signal.sport ?? ''} ${signal.league ?? ''}`.toLowerCase();
  if (blob.includes('tennis')) return 'sr:sport:5';
  if (blob.includes('basket') || blob.includes('nba') || blob.includes('wnba')) return 'sr:sport:2';
  if (blob.includes('foot') || blob.includes('soccer')) return 'sr:sport:1';
  return undefined;
}

function collectEventRows(node: unknown, out: SportyBetEventRow[], depth: number): void {
  if (depth > 14 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) collectEventRows(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;

  const o = node as Record<string, unknown>;
  const eventId = pickStr(o.eventId, o.eventID);
  const homeTeamName = pickStr(o.homeTeamName, o.homeName, o.home);
  const awayTeamName = pickStr(o.awayTeamName, o.awayName, o.away);
  if (eventId && isSportyBetEventId(eventId) && homeTeamName && awayTeamName) {
    out.push({ eventId, homeTeamName, awayTeamName });
  }
  for (const v of Object.values(o)) {
    collectEventRows(v, out, depth + 1);
  }
}

function matchEventRow(signal: OddsDropSignal, rows: SportyBetEventRow[]): SportyBetEventRow | undefined {
  const home = signal.home?.trim() ?? '';
  const away = signal.away?.trim() ?? '';
  if (!home || !away) return undefined;

  for (const row of rows) {
    const blob = `${row.homeTeamName} ${row.awayTeamName}`;
    if (rowMatchesParticipants(home, away, blob)) return row;
  }
  return undefined;
}

function listUrlForSport(sportId: string): string {
  const base = apiBaseUrl().replace(/\/+$/, '');
  const template =
    process.env.SPORTYBET_API_EVENT_LIST_PATH?.trim() ||
    '/api/ng/factsCenter/liveOrPrematchEvents?sportId={sportId}';
  const path = template.replaceAll('{sportId}', encodeURIComponent(sportId));
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchEventList(sportId: string): Promise<SportyBetEventRow[]> {
  const url = listUrlForSport(sportId);
  const res = await sportyBetApiRequest({ url, method: 'GET' });
  if (!res.ok) {
    logger.info('[sportybet-api] event list request failed', { status: res.status, url, sportId });
    return [];
  }
  const rows: SportyBetEventRow[] = [];
  collectEventRows(res.body, rows, 0);
  return rows;
}

async function resolveFromList(signal: OddsDropSignal): Promise<string | undefined> {
  const sportId = sportyBetSportIdForSignal(signal);
  if (!sportId) {
    logger.debug('[sportybet-api] event resolve skipped — unknown sport', {
      sport: signal.sport,
      league: signal.league,
    });
    return undefined;
  }

  const home = signal.home?.trim() ?? '';
  const away = signal.away?.trim() ?? '';
  if (!home || !away) {
    logger.debug('[sportybet-api] event resolve skipped — missing home/away', {
      parentId: signal.parentId,
    });
    return undefined;
  }

  const cacheKey = `${sportId}::${canonicalPairKey(home, away)}`;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAtMs > now) return hit.eventId;

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const work = (async (): Promise<string | undefined> => {
    const rows = await fetchEventList(sportId);
    const row = matchEventRow(signal, rows);
    if (!row) {
      logger.info('[sportybet-api] event resolve miss', {
        parentId: signal.parentId,
        sportId,
        home,
        away,
        candidates: rows.length,
      });
      return undefined;
    }
    cache.set(cacheKey, { eventId: row.eventId, expiresAtMs: now + cacheTtlMs() });
    logger.info('[sportybet-api] event resolved', {
      parentId: signal.parentId,
      eventId: row.eventId,
      home: row.homeTeamName,
      away: row.awayTeamName,
    });
    return row.eventId;
  })();

  inFlight.set(cacheKey, work);
  try {
    return await work;
  } finally {
    inFlight.delete(cacheKey);
  }
}

/** Pinnacle `parentId` → SportyBet `sr:match:*` via live list + participant match. */
export async function resolveSportyBetEventId(signal: OddsDropSignal): Promise<string | undefined> {
  const raw = signal.parentId?.trim() ?? '';
  if (isSportyBetEventId(raw)) return raw;
  return resolveFromList(signal);
}
