import { executionEnv } from '../config/executionEnv.js';
import { logger } from '../utils/logger.js';
import type { OddsDropSignal } from '../types/index.js';

export interface SportyBetApiQuote {
  odds: number;
  source: string;
}

/**
 * Reverse-engineered SportyBet HTTP surface (fill paths/tokens as you discover them).
 * When `SPORTYBET_ODDS_SOURCE=api`, this runs before Playwright live quotes.
 */
export async function fetchSportyBetQuoteFromApi(params: {
  signal: OddsDropSignal;
  side: 'over' | 'under';
}): Promise<SportyBetApiQuote | undefined> {
  if (executionEnv.sportyBetOddsSource !== 'api') {
    return undefined;
  }

  const base = executionEnv.sportyBetApiBaseUrl.trim() || executionEnv.sportyBetBaseUrl.trim();
  if (!base) {
    logger.warn('[sportybet-api] SPORTYBET_ODDS_SOURCE=api but SPORTYBET_API_BASE_URL is empty');
    return undefined;
  }

  const pathTemplate = executionEnv.sportyBetApiOddsPath.trim();
  if (!pathTemplate) {
    logger.warn(
      '[sportybet-api] set SPORTYBET_API_ODDS_PATH (e.g. /api/.../events/{parentId}/markets)',
    );
    return undefined;
  }

  const parentId = params.signal.parentId ?? '';
  const path = pathTemplate
    .replaceAll('{parentId}', encodeURIComponent(parentId))
    .replaceAll('{line}', encodeURIComponent(String(params.signal.line ?? '')))
    .replaceAll('{designation}', encodeURIComponent(params.signal.designation ?? params.side));

  const url = `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': executionEnv.sportyBetApiUserAgent,
    };
    const token = executionEnv.sportyBetApiAuthToken.trim();
    if (token) {
      headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    }

    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(executionEnv.sportyBetApiTimeoutMs),
    });

    if (!res.ok) {
      logger.info('[sportybet-api] odds request failed', {
        status: res.status,
        parentId,
      });
      return undefined;
    }

    const body: unknown = await res.json();
    const odds = extractDecimalOdds(body, params.side);
    if (odds != null && odds > 1 && Number.isFinite(odds)) {
      return { odds: Math.round(odds * 1000) / 1000, source: 'sportybet_api' };
    }
    logger.info('[sportybet-api] response had no usable decimal odds', { parentId });
    return undefined;
  } catch (e) {
    logger.warn('[sportybet-api] fetch error', {
      err: e instanceof Error ? e.message : String(e),
      parentId,
    });
    return undefined;
  }
}

function extractDecimalOdds(body: unknown, side: 'over' | 'under'): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const o = body as Record<string, unknown>;
  const keys = side === 'over' ? ['overOdds', 'over', 'homeOdds'] : ['underOdds', 'under', 'awayOdds'];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && v > 1) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (Number.isFinite(n) && n > 1) return n;
    }
  }
  const data = o.data;
  if (data && typeof data === 'object') {
    return extractDecimalOdds(data, side);
  }
  return undefined;
}
