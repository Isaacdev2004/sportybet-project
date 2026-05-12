import type { FullMarketQuote, OddsDropSignal } from '../types/index.js';
import { executionEnv } from '../config/executionEnv.js';
import { probeSportyBetDecimalOdds } from '../execution/sportybetLiveQuoteService.js';
import { fetchSportyBetQuoteFromApi } from './sportybetApiClient.js';
import { totalLinesEquivalent } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';

/** Synthetic `FullMarketQuote` when NVP is taken from feed `nvp` (no `/details` body). */
export const STUB_MATCH_CONTEXT_PROVIDER_NVP = 'stub:provider_nvp';

export interface SoftQuote {
  book: string;
  odds: number;
  /** over | under | etc. */
  designation?: string;
  line?: string | number;
}

/**
 * Resolves a SportyBet-side quote for EV: optional **live** UI scrape (`SPORTYBET_LIVE_QUOTES`)
 * or synthetic mock (default / fallback).
 */
export async function fetchSportyBetQuote(params: {
  signal: OddsDropSignal;
  pinnacle: FullMarketQuote;
}): Promise<SoftQuote | undefined> {
  const { signal, pinnacle } = params;

  const lineSoft = signal.line ?? pinnacle.over.line ?? pinnacle.under.line;
  const pinLine = pinnacle.over.line ?? pinnacle.under.line;
  const stubNoTotalsLine =
    pinnacle.matchContext === STUB_MATCH_CONTEXT_PROVIDER_NVP &&
    pinLine === undefined &&
    (signal.line === undefined || signal.line === '');
  const lineMatches =
    stubNoTotalsLine ||
    (lineSoft !== undefined &&
      pinLine !== undefined &&
      totalLinesEquivalent(lineSoft, pinLine));

  const useDropOddsAnchor =
    pinnacle.matchContext === STUB_MATCH_CONTEXT_PROVIDER_NVP &&
    typeof signal.currentOdds === 'number' &&
    signal.currentOdds > 1;

  // Mock: pretend alternate lines rarely match
  if (!lineMatches) {
    logger.debug('[sportybet] mock — line mismatch vs Pinnacle', {
      signalLine: signal.line,
      pinLine,
    });
    return undefined;
  }

  // Mock price: inflate current Pinnacle side (or drop `to` price when stub)
  const jitter = ((signal.parentId ?? '').length % 11) / 100;
  let align = pickSideFromSignal(signal);
  let base: number | undefined;
  if (useDropOddsAnchor) {
    base = signal.currentOdds;
  } else {
    base =
      align === 'under'
        ? pinnacle.under.odds
        : align === 'over'
          ? pinnacle.over.odds
          : undefined;
  }

  if (base === undefined) {
    // Default to the side Pinnacle moved on if known
    align = 'over';
    base = useDropOddsAnchor ? signal.currentOdds! : pinnacle.over.odds;
  }

  const alignResolved: 'over' | 'under' = align ?? 'over';
  const mockOdds = Math.round(base * (1.03 + jitter) * 1000) / 1000;

  if (executionEnv.sportyBetOddsSource === 'api') {
    const api = await fetchSportyBetQuoteFromApi({ signal, side: alignResolved });
    if (api) {
      return {
        book: 'SportyBet',
        odds: api.odds,
        designation: alignResolved,
        line: lineSoft,
      };
    }
    if (!executionEnv.sportyBetLiveQuoteFallback) {
      logger.info('[sportybet-api] strict mode — no fallback after API miss', {
        parentId: signal.parentId,
      });
      return undefined;
    }
    logger.warn('[sportybet-api] falling back after API miss', { parentId: signal.parentId });
  }

  if (
    executionEnv.sportyBetOddsSource === 'playwright' ||
    executionEnv.sportyBetLiveQuotes
  ) {
    const live = await probeSportyBetDecimalOdds({
      signal,
      side: alignResolved,
    });
    if (live != null) {
      return {
        book: 'SportyBet',
        odds: live,
        designation: alignResolved,
        line: lineSoft,
      };
    }
    if (!executionEnv.sportyBetLiveQuoteFallback) {
      logger.info('[sportybet-live] strict mode — no fallback mock', {
        parentId: signal.parentId,
      });
      return undefined;
    }
    logger.warn('[sportybet-live] using mock fallback', { parentId: signal.parentId });
    return {
      book: 'SportyBet (mock · live unreadable)',
      odds: mockOdds,
      designation: alignResolved,
      line: lineSoft,
    };
  }

  return {
    book: 'SportyBet (mock)',
    odds: mockOdds,
    designation: alignResolved,
    line: lineSoft,
  };
}

function pickSideFromSignal(signal: OddsDropSignal): 'over' | 'under' | undefined {
  const d = (signal.designation ?? '').toLowerCase();
  if (d.includes('over')) return 'over';
  if (d.includes('under')) return 'under';
  if (d.includes('away') || d.trim() === '2') return 'under';
  if (d.includes('home') || d.trim() === '1') return 'over';
  const h = (signal.home ?? '').trim().toLowerCase();
  const a = (signal.away ?? '').trim().toLowerCase();
  const trimmed = signal.designation?.trim().toLowerCase() ?? '';
  if (h && (h === trimmed || h.includes(trimmed) || trimmed.includes(h)))
    return 'over';
  if (a && (a === trimmed || a.includes(trimmed) || trimmed.includes(a)))
    return 'under';
  return undefined;
}
