import type { BetExecutionResult } from '../execution/types.js';

export type StatsRangeKey = 'today' | '7d' | '30d' | 'all';

export function utcDayBounds(nowMs = Date.now()): {
  startMs: number;
  endMs: number;
  label: string;
} {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const startMs = Date.UTC(y, m, day);
  const endMs = startMs + 86_400_000;
  const label = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { startMs, endMs, label };
}

export function rangeToMs(range: StatsRangeKey, nowMs = Date.now()): { fromMs: number; toMs: number } {
  if (range === 'all') return { fromMs: 0, toMs: nowMs + 1 };
  if (range === 'today') {
    const { startMs, endMs } = utcDayBounds(nowMs);
    return { fromMs: startMs, toMs: Math.min(endMs, nowMs + 1) };
  }
  const days = range === '7d' ? 7 : 30;
  return { fromMs: nowMs - days * 86_400_000, toMs: nowMs + 1 };
}

export interface LedgerAggregate {
  range: StatsRangeKey;
  /** Sum of per-account rows in window. */
  accountAttempts: number;
  executionCycles: number;
  placedSuccess: number;
  placedFailed: number;
  placedSkipped: number;
  /** Sum of stake where status === success */
  totalStakedSuccess: number;
  /** Average EV% over successful placement rows that have opportunity snapshot */
  avgEvPlaced: number | null;
  avgOddsPlaced: number | null;
  avgNvpPlaced: number | null;
  /** Settlement not implemented — always zero / null in this engine version */
  won: number;
  lost: number;
  pending: number;
  voided: number;
  perAccount: Record<
    string,
    {
      attempts: number;
      success: number;
      failed: number;
      skipped: number;
      staked: number;
    }
  >;
}

function touchAccount(
  map: LedgerAggregate['perAccount'],
  id: string,
  patch: Partial<{ attempts: number; success: number; failed: number; skipped: number; staked: number }>,
): void {
  const cur = map[id] ?? {
    attempts: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    staked: 0,
  };
  map[id] = {
    attempts: cur.attempts + (patch.attempts ?? 0),
    success: cur.success + (patch.success ?? 0),
    failed: cur.failed + (patch.failed ?? 0),
    skipped: cur.skipped + (patch.skipped ?? 0),
    staked: cur.staked + (patch.staked ?? 0),
  };
}

/** Aggregate execution rows already filtered by caller (time, sport, etc.). */
export function aggregateExecutionRows(
  inWin: BetExecutionResult[],
  range: StatsRangeKey,
): LedgerAggregate {

  const perAccount: LedgerAggregate['perAccount'] = {};
  let accountAttempts = 0;
  let placedSuccess = 0;
  let placedFailed = 0;
  let placedSkipped = 0;
  let totalStakedSuccess = 0;
  const evSamples: number[] = [];
  const oddsSamples: number[] = [];
  const nvpSamples: number[] = [];

  for (const r of inWin) {
    for (const ar of r.accountResults) {
      accountAttempts++;
      touchAccount(perAccount, ar.accountId, { attempts: 1 });
      if (ar.status === 'success') {
        placedSuccess++;
        touchAccount(perAccount, ar.accountId, { success: 1, staked: ar.stake });
        totalStakedSuccess += ar.stake;
        const o = r.opportunity;
        if (o) {
          evSamples.push(o.evPercent);
          oddsSamples.push(o.softOdds);
          nvpSamples.push(o.nvpDecimal);
        }
      } else if (ar.status === 'failed') {
        placedFailed++;
        touchAccount(perAccount, ar.accountId, { failed: 1 });
      } else if (ar.status === 'skipped') {
        placedSkipped++;
        touchAccount(perAccount, ar.accountId, { skipped: 1 });
      }
    }
  }

  const avg = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

  return {
    range,
    accountAttempts,
    executionCycles: inWin.length,
    placedSuccess,
    placedFailed,
    placedSkipped,
    totalStakedSuccess,
    avgEvPlaced: avg(evSamples),
    avgOddsPlaced: avg(oddsSamples),
    avgNvpPlaced: avg(nvpSamples),
    won: 0,
    lost: 0,
    pending: placedSuccess,
    voided: 0,
    perAccount,
  };
}

export function aggregateLedger(
  rows: BetExecutionResult[],
  range: StatsRangeKey,
  nowMs = Date.now(),
): LedgerAggregate {
  const { fromMs, toMs } = rangeToMs(range, nowMs);
  const inWin = rows.filter((r) => r.finishedAtMs >= fromMs && r.finishedAtMs < toMs);
  return aggregateExecutionRows(inWin, range);
}

export interface DailyTrackerUtc {
  dateLabel: string;
  executionCycles: number;
  accountAttempts: number;
  placedSuccess: number;
  placedFailed: number;
  placedSkipped: number;
  /** Profit/loss in units — requires settlement pipeline (not yet available). */
  unitsProfitLoss: null;
}

export function dailyAccountTotals(
  rows: BetExecutionResult[],
  accountId: string,
  nowMs = Date.now(),
): { placed: number; failed: number; skipped: number; unitsPnl: null } {
  const { startMs, endMs } = utcDayBounds(nowMs);
  let placed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of rows) {
    if (r.finishedAtMs < startMs || r.finishedAtMs >= endMs) continue;
    for (const ar of r.accountResults) {
      if (ar.accountId !== accountId) continue;
      if (ar.status === 'success') placed++;
      else if (ar.status === 'failed') failed++;
      else if (ar.status === 'skipped') skipped++;
    }
  }
  return { placed, failed, skipped, unitsPnl: null };
}

export function dailyTrackerFromRows(
  rows: BetExecutionResult[],
  nowMs = Date.now(),
): DailyTrackerUtc {
  const { startMs, endMs, label } = utcDayBounds(nowMs);
  const dayRows = rows.filter((r) => r.finishedAtMs >= startMs && r.finishedAtMs < endMs);
  let accountAttempts = 0;
  let placedSuccess = 0;
  let placedFailed = 0;
  let placedSkipped = 0;
  for (const r of dayRows) {
    for (const ar of r.accountResults) {
      accountAttempts++;
      if (ar.status === 'success') placedSuccess++;
      else if (ar.status === 'failed') placedFailed++;
      else if (ar.status === 'skipped') placedSkipped++;
    }
  }
  return {
    dateLabel: label,
    executionCycles: dayRows.length,
    accountAttempts,
    placedSuccess,
    placedFailed,
    placedSkipped,
    unitsProfitLoss: null,
  };
}
