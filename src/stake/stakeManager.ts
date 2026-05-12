import type { StakeRange } from '../execution/types.js';
import { executionEnv } from '../config/executionEnv.js';
import { logger } from '../utils/logger.js';

export interface StakeBetUnit {
  amount: number;
  rangeIndex: number;
}

function roundStake(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const step = executionEnv.stakeRoundStep;
  if (step > 0) {
    return Math.round(n / step) * step;
  }
  return Math.round(n * 100) / 100;
}

function pickStakeAmount(lo: number, hi: number): number {
  if (lo === hi) return roundStake(lo);
  if (executionEnv.stakePickMidpoint) {
    return roundStake((lo + hi) / 2);
  }
  const span = hi - lo;
  return roundStake(lo + Math.random() * span);
}

/**
 * Validates and coerces account stake ranges (min/max, positive, ordered).
 */
export function normalizeStakeRanges(
  ranges: StakeRange[] | undefined,
  accountId?: string,
): StakeRange[] {
  if (!Array.isArray(ranges) || ranges.length === 0) return [];
  const out: StakeRange[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const raw = ranges[i];
    if (!raw || typeof raw !== 'object') continue;
    const min = Number(raw.min);
    const max = Number(raw.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) {
      logger.warn('[stake] invalid range skipped', { accountId, index: i, min, max });
      continue;
    }
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    out.push({ min: lo, max: hi });
  }
  return out;
}

/**
 * Each closed [min,max] yields one bet stake. Default: uniform random in range; set
 * `EXECUTION_STAKE_PICK_MIDPOINT=true` for legacy average. Duplicate ranges → multiple bets.
 */
export function expandStakeRanges(ranges: StakeRange[]): StakeBetUnit[] {
  const normalized = normalizeStakeRanges(ranges);
  const out: StakeBetUnit[] = [];
  normalized.forEach((r, rangeIndex) => {
    const amount = pickStakeAmount(r.min, r.max);
    if (amount > 0) {
      out.push({ amount, rangeIndex });
    }
  });
  return out;
}

export function totalStakeAmount(units: StakeBetUnit[]): number {
  return units.reduce((s, u) => s + u.amount, 0);
}
