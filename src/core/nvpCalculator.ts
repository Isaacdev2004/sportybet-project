import type { FairPrices, FullMarketQuote } from '../types/index.js';

/**
 * Remove vig from a two-way market using proportional (multiplicative) normalization.
 *
 * Spec reference (under side, equivalent to normalized under prob):
 *   overProb = 1/overOdds, underProb = 1/underOdds, total = overProb + underProb
 *   trueProbUnder = underProb / total  =>  fairUnder = 1/trueProbUnder
 *
 * We expose both fair prices so the EV layer can match the soft book side.
 */
export function buildFairPrices(quote: FullMarketQuote): FairPrices {
  const o = quote.over.odds;
  const u = quote.under.odds;
  if (!(o > 1 && u > 1)) {
    throw new Error('NVP: both pinnacle sides must have decimal odds > 1');
  }
  const overImp = 1 / o;
  const underImp = 1 / u;
  const total = overImp + underImp;
  if (total <= 0) throw new Error('NVP: invalid implied total');

  const trueProbOver = overImp / total;
  const trueProbUnder = underImp / total;
  return {
    trueProbOver,
    trueProbUnder,
    nvpOver: 1 / trueProbOver,
    nvpUnder: 1 / trueProbUnder,
  };
}
