import { env } from '../config/env.js';
import type { FullMarketQuote } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { toDecimalOdds, withRetry } from '../utils/helpers.js';

const detailsWaitQueue: Array<() => void> = [];
let detailsInFlight = 0;

/** Serialize / throttle parallel /kit/v1/details (trial tiers 429 instantly if you fan out dozens). */
async function withPinnacleDetailsSlot<T>(fn: () => Promise<T>): Promise<T> {
  const max = env.pinnacle.detailsMaxConcurrent;
  while (detailsInFlight >= max) {
    await new Promise<void>((resolve) => detailsWaitQueue.push(resolve));
  }
  detailsInFlight++;
  try {
    return await fn();
  } finally {
    detailsInFlight--;
    const next = detailsWaitQueue.shift();
    if (next) next();
  }
}

function firstString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

function firstNumber(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    const n = toDecimalOdds(v);
    if (n !== undefined) return n;
  }
  return undefined;
}

/** Hints derived from SSE / drop row so `/details` resolves the right totals row */
export interface MarketFetchHints {
  period?: number;
  line?: string | number;
  marketLabel?: string;
  designation?: string;
}

function trimBase(base: string): string {
  return base.replace(/\/+$/, '');
}

function pinnacleHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  const key = env.pinnacle.apiKey.trim();
  if (key) h['x-portal-apikey'] = key;
  return h;
}

/** PinnOdds totals/spreads/moneyline: only totals map to two-way NVP in this Phase-1 bot. */
export function isPinnoddTotalMarket(hints?: MarketFetchHints): boolean {
  if (!hints) return false;
  const label = `${hints.marketLabel ?? ''} ${hints.designation ?? ''}`.toLowerCase();
  if (label.includes('moneyline')) return false;
  if (label.includes('spread')) return false;
  if (label.includes('team_total')) return true;
  if (label.includes('total')) return true;
  return /\bover\b|\bunder\b/.test(label);
}

export function unwrapPinnoddEvent(json: unknown): Record<string, unknown> | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const r = json as Record<string, unknown>;
  if (r.event_id !== undefined && r.periods !== undefined) return r;
  if (r.periods !== undefined && (r.home !== undefined || r.event_id !== undefined)) return r;
  const inner = r.event;
  if (inner && typeof inner === 'object') return inner as Record<string, unknown>;
  const events = r.events;
  if (Array.isArray(events) && events.length > 0 && typeof events[0] === 'object') {
    return events[0] as Record<string, unknown>;
  }
  return undefined;
}

function pickTotalsRow(
  totals: Record<string, unknown>,
  lineHint: string | number | undefined,
): { over: unknown; under: unknown; points: number } | undefined {
  if (lineHint !== undefined && lineHint !== '') {
    const wantNum = typeof lineHint === 'number' ? lineHint : Number(lineHint);
    for (const [k, raw] of Object.entries(totals)) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const ptsRaw = row.points ?? k;
      const ptsNum = typeof ptsRaw === 'number' ? ptsRaw : Number(ptsRaw);
      const keyNum = Number(k);
      if (Number.isFinite(wantNum)) {
        if (Number.isFinite(ptsNum) && Math.abs(ptsNum - wantNum) < 1e-6) {
          return { over: row.over, under: row.under, points: ptsNum };
        }
        if (Number.isFinite(keyNum) && Math.abs(keyNum - wantNum) < 1e-6) {
          const p = Number.isFinite(ptsNum) ? ptsNum : keyNum;
          return { over: row.over, under: row.under, points: p };
        }
      }
      if (String(k) === String(lineHint).trim()) {
        const p = Number.isFinite(ptsNum) ? ptsNum : keyNum;
        return { over: row.over, under: row.under, points: p };
      }
    }
  }

  const keys = Object.keys(totals);
  if (keys.length === 1) {
    const raw = totals[keys[0]!];
    if (raw && typeof raw === 'object') {
      const row = raw as Record<string, unknown>;
      const pnum = Number(row.points ?? keys[0]);
      return {
        over: row.over,
        under: row.under,
        points: Number.isFinite(pnum) ? pnum : Number(keys[0]),
      };
    }
  }

  return undefined;
}

/** Map PinnOdds `/kit/v1/details` Event object → two-way totals quote. */
export function extractTotalsFromPinnoddEvent(params: {
  event: Record<string, unknown>;
  eventIdForRef: string;
  hints?: MarketFetchHints;
}): FullMarketQuote | undefined {
  const { event, eventIdForRef, hints } = params;

  const sport = firstString(event, ['sport_name', 'sport', 'sportName']);
  const league = firstString(event, ['league_name', 'league', 'leagueName']);
  const home = firstString(event, ['home', 'home_team', 'homeTeam']);
  const away = firstString(event, ['away', 'away_team', 'awayTeam']);
  const etRaw = firstString(event, ['event_type', 'eventType']);
  const etNorm = (etRaw ?? '').trim().toLowerCase().replace(/-/g, '_');
  let isLive = etNorm === 'live' || etNorm === 'in_play';
  if (typeof event.is_live === 'boolean') isLive = event.is_live;
  if (typeof event.isLive === 'boolean') isLive = event.isLive;

  const periods = event.periods as Record<string, unknown> | undefined;
  if (!periods) return undefined;

  const pIdx = hints?.period ?? 0;
  /** Quarter / segment drops: try signaled `num_*` first, then full game `num_0`. */
  const periodTryOrder = pIdx === 0 ? [0] : [pIdx, 0];

  for (const pi of periodTryOrder) {
    const periodKey = `num_${pi}`;
    const block = periods[periodKey] as Record<string, unknown> | undefined;
    if (!block || typeof block !== 'object') {
      logger.debug('[oddsFetcher] pinnodd period missing (try next)', {
        periodKey,
        eventIdForRef,
      });
      continue;
    }

    const totals = block.totals as Record<string, unknown> | undefined;
    if (!totals || typeof totals !== 'object') continue;

    const picked = pickTotalsRow(totals, hints?.line);
    if (!picked) continue;

    const over = toDecimalOdds(picked.over);
    const under = toDecimalOdds(picked.under);
    if (!over || !under) continue;

    const meta = block.meta as Record<string, unknown> | undefined;
    const matchContext = meta
      ? `H${String(meta.home_score ?? '?')}–A${String(meta.away_score ?? '?')}`
      : undefined;

    return {
      parentId: eventIdForRef,
      sport,
      league,
      home,
      away,
      market: hints?.marketLabel ?? 'total',
      isLive,
      matchContext,
      over: { designation: 'over', odds: over, line: picked.points },
      under: { designation: 'under', odds: under, line: picked.points },
    };
  }

  logger.debug('[oddsFetcher] pinnodd totals not resolved after period fallbacks', {
    eventIdForRef,
    line: hints?.line,
    periodRequested: pIdx,
  });
  return undefined;
}

/**
 * Normalize provider JSON into our two-way market type (legacy / generic shapes).
 */
export function normalizeMarketPayload(
  parentId: string,
  body: unknown,
): FullMarketQuote | undefined {
  const pinn = unwrapPinnoddEvent(body);
  if (pinn) {
    const q = extractTotalsFromPinnoddEvent({
      event: pinn,
      eventIdForRef: parentId,
      hints: undefined,
    });
    if (q) return q;
  }

  if (!body || typeof body !== 'object') return undefined;
  const root = body as Record<string, unknown>;

  const sport = firstString(root, ['sport', 'sport_name', 'sportName']);
  const league = firstString(root, ['league', 'league_name', 'leagueName']);
  const home = firstString(root, ['home', 'home_team', 'homeTeam']);
  const away = firstString(root, ['away', 'away_team', 'awayTeam']);
  const market = firstString(root, ['market', 'market_name', 'marketName']);
  const isLive =
    typeof root.is_live === 'boolean'
      ? root.is_live
      : typeof root.isLive === 'boolean'
        ? root.isLive
        : undefined;
  const matchContext = firstString(root, [
    'match_context',
    'matchContext',
    'score',
    'clock',
  ]);

  const overObj = root.over;
  const underObj = root.under;
  if (
    overObj &&
    underObj &&
    typeof overObj === 'object' &&
    typeof underObj === 'object'
  ) {
    const o = overObj as Record<string, unknown>;
    const u = underObj as Record<string, unknown>;
    const oOdds = toDecimalOdds(o.odds ?? o.price);
    const uOdds = toDecimalOdds(u.odds ?? u.price);
    if (oOdds && uOdds) {
      return {
        parentId,
        sport,
        league,
        home,
        away,
        market,
        isLive,
        matchContext,
        over: {
          designation: 'over',
          odds: oOdds,
          line: (o.line ?? o.handicap ?? o.points) as string | number | undefined,
        },
        under: {
          designation: 'under',
          odds: uOdds,
          line: (u.line ?? u.handicap ?? u.points) as string | number | undefined,
        },
      };
    }
  }

  const selections = root.selections ?? root.outcomes ?? root.runners;
  if (Array.isArray(selections) && selections.length >= 2) {
    const parsed: { des: string; odds: number; line?: string | number }[] = [];
    for (const s of selections) {
      if (!s || typeof s !== 'object') continue;
      const r = s as Record<string, unknown>;
      const name = String(
        r.name ?? r.designation ?? r.side ?? r.label ?? '',
      ).toLowerCase();
      const odds = toDecimalOdds(r.odds ?? r.price ?? r.decimal);
      if (!odds) continue;
      const line = (r.line ?? r.handicap ?? r.points) as string | number | undefined;
      let des = 'selection';
      if (name.includes('over')) des = 'over';
      else if (name.includes('under')) des = 'under';
      parsed.push({ des, odds, line });
    }
    const over = parsed.find((p) => p.des === 'over');
    const under = parsed.find((p) => p.des === 'under');
    if (over && under) {
      return {
        parentId,
        sport,
        league,
        home,
        away,
        market,
        isLive,
        matchContext,
        over: { designation: 'over', odds: over.odds, line: over.line },
        under: { designation: 'under', odds: under.odds, line: under.line },
      };
    }
  }

  const flatOver = firstNumber(root, ['over_odds', 'overOdds', 'over_price']);
  const flatUnder = firstNumber(root, ['under_odds', 'underOdds', 'under_price']);
  const flatLine = root.line ?? root.handicap;
  if (flatOver && flatUnder) {
    return {
      parentId,
      sport,
      league,
      home,
      away,
      market,
      isLive,
      matchContext,
      over: { designation: 'over', odds: flatOver, line: flatLine as string | number | undefined },
      under: { designation: 'under', odds: flatUnder, line: flatLine as string | number | undefined },
    };
  }

  logger.debug('[oddsFetcher] unmapped market payload shape', {
    keys: Object.keys(root).slice(0, 40),
  });
  return undefined;
}

/**
 * Fetch full event from PinnOdds `GET /kit/v1/details?event_id=` and extract matching total.
 */
export async function fetchFullMarket(
  eventId: string,
  hints?: MarketFetchHints,
): Promise<FullMarketQuote | undefined> {
  const key = env.pinnacle.apiKey.trim();
  if (!key) {
    logger.warn('[oddsFetcher] PINNACLE_API_KEY empty — using dev mock quote');
    return devMockMarket(eventId);
  }

  if (hints && !isPinnoddTotalMarket(hints)) {
    logger.debug('[oddsFetcher] skip details for non-total market (Phase 1)', {
      eventId,
      hints,
    });
    return undefined;
  }

  const base = trimBase(env.pinnacle.apiBase || 'https://pinnodds.com');
  const url = `${base}/kit/v1/details?event_id=${encodeURIComponent(eventId)}`;
  const headers = pinnacleHeaders();

  return withPinnacleDetailsSlot(async () => {
    try {
      const json = await withRetry(
        `GET ${url}`,
        async () => {
          const res = await fetch(url, { headers });
          if (res.status === 429) {
            await res.text().catch(() => {});
            throw new Error('odds_fetch_http_429');
          }
          if (!res.ok) {
            await res.text().catch(() => {});
            throw new Error(`odds_fetch_http_${res.status}`);
          }
          return (await res.json()) as unknown;
        },
        { maxRetries: env.http.maxRetries },
      );

      const event = unwrapPinnoddEvent(json);
      if (!event) {
        logger.warn('[oddsFetcher] details JSON not an event', { eventId });
        return undefined;
      }

      const q = extractTotalsFromPinnoddEvent({
        event,
        eventIdForRef: eventId,
        hints,
      });
      if (!q) {
        logger.debug('[oddsFetcher] no matching total for line/period', {
          eventId,
          line: hints?.line,
          period: hints?.period,
        });
        return undefined;
      }
      return q;
    } catch (e) {
      logger.warn('[oddsFetcher] failed to fetch market', {
        eventId,
        err: e instanceof Error ? e.message : String(e),
      });
      return undefined;
    }
  });
}

function devMockMarket(parentId: string): FullMarketQuote {
  const over = 1.9 + (parentId.length % 7) * 0.01;
  const under = 2.0 - (parentId.length % 5) * 0.01;
  return {
    parentId,
    sport: 'soccer',
    league: 'friendly',
    home: 'Home FC',
    away: 'Away United',
    market: 'totals',
    isLive: true,
    matchContext: 'live · mock',
    over: { designation: 'over', odds: over, line: 2.5 },
    under: { designation: 'under', odds: under, line: 2.5 },
  };
}
