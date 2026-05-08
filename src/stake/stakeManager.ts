import type { StakeRange } from '../execution/types.js';

export interface StakeBetUnit {
  amount: number;
  rangeIndex: number;
}

/**
 * Each closed [min,max] range yields one bet stake = random uniform choice in range for simplicity,
 * or fixed midpoint — here: **min** when min===max, else average rounded.
 * Multiple identical ranges yield multiple bets per spec.
 */
export function expandStakeRanges(ranges: StakeRange[]): StakeBetUnit[] {
  const out: StakeBetUnit[] = [];
  ranges.forEach((r, rangeIndex) => {
    const lo = Math.min(r.min, r.max);
    const hi = Math.max(r.min, r.max);
    const amount = lo === hi ? lo : Math.round((lo + hi) / 2);
    if (amount > 0 && Number.isFinite(amount)) {
      out.push({ amount, rangeIndex });
    }
  });
  return out;
}

export function totalStakeAmount(units: StakeBetUnit[]): number {
  return units.reduce((s, u) => s + u.amount, 0);
}
