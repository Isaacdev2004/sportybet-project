import type { OddsDropSignal } from '../types/index.js';
import type { SportyBetMarketKey } from './types.js';

/**
 * Maps Pinnacle/PinnOdds drop → SportyBet navigation key.
 */
export function mapSignalToSportyBetKey(signal: OddsDropSignal): SportyBetMarketKey {
  return {
    home: (signal.home ?? '').trim(),
    away: (signal.away ?? '').trim(),
    league: (signal.league ?? '').trim(),
    sport: (signal.sport ?? '').trim(),
    sector: (signal.sector ?? signal.market ?? '').trim(),
    line: signal.line,
    designation: (signal.designation ?? '').trim(),
    parentId: signal.parentId ?? '',
  };
}

/** Log-friendly fixture label (no search usage). */
export function fixtureLabelForLog(key: SportyBetMarketKey): string {
  return [key.home, key.away].filter(Boolean).join(' vs ');
}
