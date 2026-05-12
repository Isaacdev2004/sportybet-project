import { executionEnv } from '../config/executionEnv.js';
import { logger } from '../utils/logger.js';
import type { OddsDropSignal } from '../types/index.js';
import { appendSportyBetApiCatalog } from './sportybet/api/catalog.js';
import { resolveSportyBetEventId } from './sportybet/api/eventResolve.js';
import {
  extractDecimalOddsFromBody,
  extractOddsNearAnchor,
  pinnacleAnchorOdds,
} from './sportybet/api/responseExtract.js';
import { sportyBetApiRequest } from './sportybet/api/sessionTransport.js';

export interface SportyBetApiQuote {
  odds: number;
  source: string;
  url?: string;
}

function apiBaseUrl(): string {
  return executionEnv.sportyBetApiBaseUrl.trim() || executionEnv.sportyBetBaseUrl.trim();
}

function expandPathTemplate(
  template: string,
  signal: OddsDropSignal,
  side: 'over' | 'under',
  eventId: string,
): string {
  const parentId = eventId || signal.parentId || '';
  const line = String(signal.line ?? '');
  const designation = signal.designation ?? side;
  const sport = signal.sport ?? '';
  const league = signal.league ?? '';
  const home = signal.home ?? '';
  const away = signal.away ?? '';
  const market = signal.market ?? signal.sector ?? '';

  return template
    .replaceAll('{eventId}', encodeURIComponent(eventId))
    .replaceAll('{parentId}', encodeURIComponent(parentId))
    .replaceAll('{line}', encodeURIComponent(line))
    .replaceAll('{designation}', encodeURIComponent(designation))
    .replaceAll('{side}', encodeURIComponent(side))
    .replaceAll('{sport}', encodeURIComponent(sport))
    .replaceAll('{league}', encodeURIComponent(league))
    .replaceAll('{home}', encodeURIComponent(home))
    .replaceAll('{away}', encodeURIComponent(away))
    .replaceAll('{market}', encodeURIComponent(market));
}

function buildRequestUrls(
  signal: OddsDropSignal,
  side: 'over' | 'under',
  eventId: string,
): string[] {
  const base = apiBaseUrl().replace(/\/+$/, '');
  const paths = executionEnv.sportyBetApiOddsPaths;
  if (paths.length === 0) return [];
  return paths.map((p: string) => {
    const path = expandPathTemplate(p, signal, side, eventId);
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  });
}

function oddsFromResponse(
  body: unknown,
  side: 'over' | 'under',
  signal: OddsDropSignal,
): number | undefined {
  const line = signal.line ?? undefined;
  const direct = extractDecimalOddsFromBody(
    body,
    side,
    executionEnv.sportyBetApiOddsJsonPath,
    line,
  );
  if (direct != null) return direct;
  if (!executionEnv.sportyBetApiHeuristicExtract) return undefined;
  return extractOddsNearAnchor(body, pinnacleAnchorOdds(signal));
}

/**
 * Reverse-engineered SportyBet HTTP odds (session cookies + catalog). Primary soft-book path when
 * `SPORTYBET_ODDS_SOURCE=api`.
 */
export async function fetchSportyBetQuoteFromApi(params: {
  signal: OddsDropSignal;
  side: 'over' | 'under';
}): Promise<SportyBetApiQuote | undefined> {
  if (executionEnv.sportyBetOddsSource !== 'api') {
    return undefined;
  }

  const paths = executionEnv.sportyBetApiOddsPaths;
  if (paths.length === 0) {
    logger.warn(
      '[sportybet-api] SPORTYBET_ODDS_SOURCE=api but no SPORTYBET_API_ODDS_PATH(S) — run npm run discover:sportybet-api',
    );
    return undefined;
  }

  const eventId = (await resolveSportyBetEventId(params.signal)) ?? '';
  if (!eventId) {
    logger.info('[sportybet-api] no SportyBet event id — skip odds request', {
      parentId: params.signal.parentId,
      home: params.signal.home,
      away: params.signal.away,
      sport: params.signal.sport,
    });
    return undefined;
  }

  const urls = buildRequestUrls(params.signal, params.side, eventId);

  for (const url of urls) {
    try {
      const res = await sportyBetApiRequest({ url, method: 'GET' });
      if (executionEnv.sportyBetApiCapture) {
        appendSportyBetApiCatalog({
          ts: Date.now(),
          method: 'GET',
          url,
          status: res.status,
          contentType: 'application/json',
          sample:
            typeof res.body === 'string'
              ? res.body.slice(0, executionEnv.sportyBetApiCaptureSampleBytes)
              : JSON.stringify(res.body).slice(0, executionEnv.sportyBetApiCaptureSampleBytes),
        });
      }
      if (!res.ok) {
        logger.info('[sportybet-api] odds request failed', {
          status: res.status,
          url,
          parentId: params.signal.parentId,
          eventId,
        });
        continue;
      }
      const odds = oddsFromResponse(res.body, params.side, params.signal);
      if (odds != null && odds > 1 && Number.isFinite(odds)) {
        return {
          odds: Math.round(odds * 1000) / 1000,
          source: `sportybet_api:${res.via}`,
          url,
        };
      }
      logger.info('[sportybet-api] response had no usable decimal odds', {
        url,
        parentId: params.signal.parentId,
        eventId,
      });
    } catch (e) {
      logger.warn('[sportybet-api] fetch error', {
        err: e instanceof Error ? e.message : String(e),
        url,
        parentId: params.signal.parentId,
        eventId,
      });
    }
  }

  return undefined;
}
