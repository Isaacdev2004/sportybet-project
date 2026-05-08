import type { ExpectedValueResult, FairPrices, FullMarketQuote } from '../types/index.js';

export type AlignSide = 'over' | 'under';

export function computeEvFromProviderFairOdds(params: {
  fairDecimalOdds: number;
  softOdds: number;
  align: AlignSide;
}): ExpectedValueResult {
  const nvpUsed = params.fairDecimalOdds;
  if (!(params.softOdds > 1) || !(nvpUsed > 1)) {
    throw new Error('EV: odds must be > 1');
  }
  const evPercent = ((params.softOdds - nvpUsed) / nvpUsed) * 100;
  return {
    side: params.align,
    nvpUsed,
    softOdds: params.softOdds,
    evPercent,
  };
}

export function computeEvAgainstNvp(params: {
  fair: FairPrices;
  softOdds: number;
  align: AlignSide;
}): ExpectedValueResult {
  const nvpUsed = params.align === 'over' ? params.fair.nvpOver : params.fair.nvpUnder;
  if (!(params.softOdds > 1) || !(nvpUsed > 1)) {
    throw new Error('EV: odds must be > 1');
  }
  const evPercent = ((params.softOdds - nvpUsed) / nvpUsed) * 100;
  return {
    side: params.align,
    nvpUsed,
    softOdds: params.softOdds,
    evPercent,
  };
}

/**
 * Map a soft-book designation string to our over/under alignment.
 * Moneyline "Home"/"Away" maps to over/under for legacy two-way structs only (labels in Telegram).
 */
export function pickAlignSide(softDesignation: string | undefined): AlignSide | undefined {
  const d = (softDesignation ?? '').toLowerCase();
  if (d.includes('over')) return 'over';
  if (d.includes('under')) return 'under';
  if (d.includes('away') || d.trim() === '2') return 'under';
  if (d.includes('home') || d.trim() === '1') return 'over';
  return undefined;
}

/** Participant label vs home/away (PinnOdds often sends player name instead of literal "Home"). */
export function inferMoneylineAlignFromSignal(signal: {
  home?: string;
  away?: string;
  designation?: string;
}): AlignSide | undefined {
  const d = (signal.designation ?? '').trim().toLowerCase();
  const h = (signal.home ?? '').trim().toLowerCase();
  const a = (signal.away ?? '').trim().toLowerCase();
  if (!d || (!h && !a)) return undefined;
  if (h === d || h.endsWith(d) || d.endsWith(h) || h.includes(d)) return 'over';
  if (a === d || a.endsWith(d) || d.endsWith(a) || a.includes(d)) return 'under';
  return undefined;
}

/** When designation is missing, align to the Pinnacle side closest to the soft quote. */
export function inferAlignFromSoftOdds(softOdds: number, pinnacle: FullMarketQuote): AlignSide {
  const dOver = Math.abs(softOdds - pinnacle.over.odds);
  const dUnder = Math.abs(softOdds - pinnacle.under.odds);
  return dOver <= dUnder ? 'over' : 'under';
}
