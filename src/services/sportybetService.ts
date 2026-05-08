import type { FullMarketQuote, OddsDropSignal } from '../types/index.js';
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
 * Phase 1: simulated SportyBet latency + pricing.
 * Replace internals with HTTP/scraper when wiring real odds.
 */
export async function fetchSportyBetQuote(params: {
  signal: OddsDropSignal;
  pinnacle: FullMarketQuote;
}): Promise<SoftQuote | undefined> {
  const { signal, pinnacle } = params;

  // Async boundary — keeps call graph consistent with future I/O
  await Promise.resolve();

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

  const softOdds = base * (1.03 + jitter);

  return {
    book: 'SportyBet (mock)',
    odds: Math.round(softOdds * 1000) / 1000,
    designation: align,
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
