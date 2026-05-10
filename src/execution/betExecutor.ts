import type { BettingOpportunity } from '../types/index.js';
import {
  buildDefaultExecutionSettings,
  passAccountExecutionFilters,
  passGlobalExecutionFilters,
} from '../filters/filterEngine.js';
import type {
  ExecutionAccount,
  ExecutionSettings,
  BetExecutionResult,
  SingleBetResult,
  ExecutionLogOutcome,
} from './types.js';
import { getAccounts } from '../account/accountManager.js';
import { expandStakeRanges } from '../stake/stakeManager.js';
import {
  buildDedupKey,
  getDedupBackend,
  shouldSkipDuplicate,
} from '../risk/dedupManager.js';
import { ExecutionBudget, ExecutionTimeExceededError } from '../risk/riskManager.js';
import { NavigationEngine } from './navigationEngine.js';
import { executionEnv } from '../config/executionEnv.js';
import { mapSignalToSportyBetKey } from './marketMapper.js';
import { ensureLoggedInSportyBet } from './sessionManager.js';
import { fetchSportyBetLiveOddsForProbe } from './sportybetOddsProbe.js';
import { logger } from '../utils/logger.js';
import { appendExecutionLog } from '../state/executionLogStore.js';
import { runAccountWorkerExclusive } from '../utils/serialQueue.js';

/** Round-robin assigns each opportunity to a worker slot so up to N runs overlap per account. */
const accountWorkerRoundRobin = new Map<string, number>();
function pickAccountWorkerSlot(accountId: string, workerCount: number): number {
  if (workerCount <= 1) return 0;
  const cur = accountWorkerRoundRobin.get(accountId) ?? 0;
  const slot = cur % workerCount;
  accountWorkerRoundRobin.set(accountId, cur + 1);
  return slot;
}

function opportunityId(opp: BettingOpportunity): string {
  return `${opp.signal.parentId ?? 'x'}::${opp.evPercent.toFixed(2)}`;
}

function outcomeFromAccountRows(rows: SingleBetResult[]): ExecutionLogOutcome {
  const hasSuccess = rows.some((r) => r.status === 'success');
  const hasFailed = rows.some((r) => r.status === 'failed');
  const hasSkipped = rows.some((r) => r.status === 'skipped');
  const hasPartial = rows.some((r) => r.status === 'partial');
  if (hasSuccess && !hasFailed && !hasSkipped && !hasPartial) return 'placed';
  if (hasSuccess && (hasFailed || hasSkipped || hasPartial)) return 'partial';
  if (hasPartial && !hasSuccess) return 'partial';
  if (hasFailed && !hasSuccess) return 'failed';
  if (hasSkipped && !hasSuccess && !hasFailed) return 'all_skipped';
  return rows.length === 0 ? 'failed' : 'all_skipped';
}

function globalPassFromOutcome(o: ExecutionLogOutcome): boolean {
  return o === 'placed' || o === 'partial';
}

/** Wall-clock deltas from provider drop receipt → execution milestones (ms). */
function buildDropTimingSnapshot(
  opp: BettingOpportunity,
  startedAtMs: number,
  finishedAtMs: number,
  accountResults: SingleBetResult[],
): Pick<
  BetExecutionResult,
  | 'signalReceivedAtMs'
  | 'dropToExecutionStartMs'
  | 'dropToExecutionFinishedMs'
  | 'dropToFirstPlacementMs'
  | 'dropToLastPlacementMs'
> {
  const signalReceivedAtMs = opp.signal.receivedAtMs;
  const dropToExecutionStartMs = Math.max(0, startedAtMs - signalReceivedAtMs);
  const dropToExecutionFinishedMs = Math.max(0, finishedAtMs - signalReceivedAtMs);
  const successFinished = accountResults
    .filter(
      (r): r is SingleBetResult & { finishedAtMs: number } =>
        r.status === 'success' && typeof r.finishedAtMs === 'number',
    )
    .map((r) => r.finishedAtMs);
  if (successFinished.length === 0) {
    return {
      signalReceivedAtMs,
      dropToExecutionStartMs,
      dropToExecutionFinishedMs,
    };
  }
  const minF = Math.min(...successFinished);
  const maxF = Math.max(...successFinished);
  return {
    signalReceivedAtMs,
    dropToExecutionStartMs,
    dropToExecutionFinishedMs,
    dropToFirstPlacementMs: Math.max(0, minF - signalReceivedAtMs),
    dropToLastPlacementMs: Math.max(0, maxF - signalReceivedAtMs),
  };
}

type PreflightResult =
  | { ok: true; stakes: ReturnType<typeof expandStakeRanges>; softIsMock: boolean; probeIsSignalOnly: boolean }
  | { ok: false; rows: SingleBetResult[] };

/**
 * Cheap checks + odds probe — runs **outside** the per-worker mutex so overlapping
 * opportunities can preflight in parallel while another bet holds a browser slot.
 */
async function preflightExecutionForAccount(params: {
  opp: BettingOpportunity;
  account: ExecutionAccount;
  settings: ExecutionSettings;
}): Promise<PreflightResult> {
  const { opp, account, settings } = params;
  const t0 = Date.now();

  const accFilter = passAccountExecutionFilters(account, opp);
  if (!accFilter.ok) {
    const ts = Date.now();
    return {
      ok: false,
      rows: [
        {
          accountId: account.id,
          stake: 0,
          status: 'skipped',
          reason: accFilter.reason ?? 'account_filter',
          latencyMs: ts - t0,
          finishedAtMs: ts,
        },
      ],
    };
  }

  const probe = await fetchSportyBetLiveOddsForProbe({
    baseUrl: settings.sportyBetBaseUrl,
    signal: opp.signal,
    expectedSide: opp.side,
  });

  const softIsMock = /\bmock\b/i.test(opp.softBookLabel);
  const probeIsSignalOnly = probe?.source === 'signal_anchor';
  if (
    probe &&
    !softIsMock &&
    !probeIsSignalOnly &&
    Math.abs(probe.odds - opp.softOdds) > settings.maxOddsDrift
  ) {
    const ts = Date.now();
    return {
      ok: false,
      rows: [
        {
          accountId: account.id,
          stake: 0,
          status: 'skipped',
          reason: 'odds_drift',
          latencyMs: ts - t0,
          finishedAtMs: ts,
        },
      ],
    };
  }

  const stakes = expandStakeRanges(account.stakeRanges);
  if (stakes.length === 0) {
    const ts = Date.now();
    return {
      ok: false,
      rows: [
        {
          accountId: account.id,
          stake: 0,
          status: 'skipped',
          reason: 'no_stake_ranges',
          latencyMs: ts - t0,
          finishedAtMs: ts,
        },
      ],
    };
  }

  return { ok: true, stakes, softIsMock, probeIsSignalOnly };
}

async function executeBrowserForAccount(params: {
  opp: BettingOpportunity;
  account: ExecutionAccount;
  settings: ExecutionSettings;
  budget: ExecutionBudget;
  nav: NavigationEngine;
  stakes: ReturnType<typeof expandStakeRanges>;
  softIsMock: boolean;
  probeIsSignalOnly: boolean;
  t0: number;
  workerSlot: number;
}): Promise<SingleBetResult[]> {
  const {
    opp,
    account,
    settings,
    budget,
    nav,
    stakes,
    softIsMock,
    probeIsSignalOnly,
    t0,
    workerSlot,
  } = params;
  const results: SingleBetResult[] = [];

  try {
    const sessionPage = await ensureLoggedInSportyBet({
      account,
      headless: settings.headless,
      budget,
      workerSlot,
    });
    const key = mapSignalToSportyBetKey(opp.signal);
    const navOutcome = await nav.navigateToMarket({
      page: sessionPage,
      key,
      budget,
      side: opp.side,
      softOdds: opp.softOdds,
      maxOddsDrift: settings.maxOddsDrift,
      skipOnPageOddsCompare: softIsMock || probeIsSignalOnly,
    });
    if (!navOutcome.ok) {
      const ts = Date.now();
      return [
        {
          accountId: account.id,
          stake: 0,
          status: 'skipped' as const,
          reason: navOutcome.skipReason ?? 'navigation_failed',
          latencyMs: ts - t0,
          finishedAtMs: ts,
        },
      ];
    }

    budget.assertWithin();

    const placeResults = await Promise.all(
      stakes.map(async (unit) => {
        const st = Date.now();
        if (budget.isExceeded()) {
          const ts = Date.now();
          return {
            accountId: account.id,
            stake: unit.amount,
            status: 'skipped' as const,
            reason: 'budget_exhausted',
            latencyMs: ts - st,
            finishedAtMs: ts,
          };
        }
        const placed = await nav.fillStakeAndPlace({
          page: sessionPage,
          stake: unit.amount,
          budget,
        });
        const ts = Date.now();
        return {
          accountId: account.id,
          stake: unit.amount,
          status: placed ? ('success' as const) : ('failed' as const),
          reason: placed ? undefined : 'place_returned_false',
          latencyMs: ts - st,
          finishedAtMs: ts,
        };
      }),
    );
    results.push(...placeResults);
  } catch (e) {
    const msg =
      e instanceof ExecutionTimeExceededError
        ? 'execution_time_exceeded'
        : e instanceof Error
          ? e.message
          : String(e);
    const ts = Date.now();
    results.push({
      accountId: account.id,
      stake: 0,
      status: 'failed',
      reason: msg,
      latencyMs: ts - t0,
      finishedAtMs: ts,
    });
  }

  return results;
}

/**
 * End-to-end automated placement. Respects **maxExecutionMs**.
 * Each account uses **accountWorkers** parallel slots (separate Playwright contexts); each slot serializes runs.
 * Multiple accounts still run concurrently via `Promise.all`.
 */
export async function executeBetsOnOpportunity(
  opp: BettingOpportunity,
  settings: ExecutionSettings = buildDefaultExecutionSettings(),
): Promise<BetExecutionResult> {
  const startedAtMs = Date.now();
  const oppId = opportunityId(opp);

  if (!settings.enabled) {
    const finishedAtMs = Date.now();
    const accountResults: SingleBetResult[] = [];
    const result: BetExecutionResult = {
      opportunityId: oppId,
      parentId: opp.signal.parentId,
      startedAtMs,
      finishedAtMs,
      totalLatencyMs: finishedAtMs - startedAtMs,
      ...buildDropTimingSnapshot(opp, startedAtMs, finishedAtMs, accountResults),
      globalPass: false,
      outcome: 'execution_off',
      skipReason: 'execution_disabled',
      accountResults,
    };
    appendExecutionLog(result);
    return result;
  }

  const glob = passGlobalExecutionFilters(opp, settings.global);
  if (!glob.ok) {
    const finishedAtMs = Date.now();
    const accountResults: SingleBetResult[] = [];
    const result: BetExecutionResult = {
      opportunityId: oppId,
      parentId: opp.signal.parentId,
      startedAtMs,
      finishedAtMs,
      totalLatencyMs: finishedAtMs - startedAtMs,
      ...buildDropTimingSnapshot(opp, startedAtMs, finishedAtMs, accountResults),
      globalPass: false,
      outcome: 'filtered_out',
      skipReason: glob.reason ?? 'global_filter',
      accountResults,
    };
    appendExecutionLog(result);
    return result;
  }

  const dedupKey = buildDedupKey({
    parentId: opp.signal.parentId,
    market: opp.signal.market,
    sector: opp.signal.sector,
    line: opp.signal.line,
  });
  if (shouldSkipDuplicate(getDedupBackend(), dedupKey, settings.dedupTtlMs)) {
    const finishedAtMs = Date.now();
    const accountResults: SingleBetResult[] = [];
    const result: BetExecutionResult = {
      opportunityId: oppId,
      parentId: opp.signal.parentId,
      startedAtMs,
      finishedAtMs,
      totalLatencyMs: finishedAtMs - startedAtMs,
      ...buildDropTimingSnapshot(opp, startedAtMs, finishedAtMs, accountResults),
      globalPass: false,
      outcome: 'dedup_skipped',
      skipReason: 'dedup_duplicate_line',
      accountResults,
    };
    appendExecutionLog(result);
    return result;
  }

  const accounts = getAccounts().filter((a) => a.enabled !== false);
  if (accounts.length === 0) {
    const finishedAtMs = Date.now();
    const accountResults: SingleBetResult[] = [];
    const result: BetExecutionResult = {
      opportunityId: oppId,
      parentId: opp.signal.parentId,
      startedAtMs,
      finishedAtMs,
      totalLatencyMs: finishedAtMs - startedAtMs,
      ...buildDropTimingSnapshot(opp, startedAtMs, finishedAtMs, accountResults),
      globalPass: false,
      outcome: 'no_enabled_accounts',
      skipReason: 'no_accounts',
      accountResults,
    };
    appendExecutionLog(result);
    return result;
  }

  const nav = new NavigationEngine(settings.sportyBetBaseUrl);

  const workerCount = executionEnv.accountWorkers;
  logger.info('[execution] start', {
    oppId,
    parentId: opp.signal.parentId,
    accounts: accounts.map((a) => a.id),
    maxMs: settings.maxExecutionMs,
    accountWorkers: workerCount,
  });

  let accountResults: SingleBetResult[] = [];
  const queueWaitSamples: number[] = [];
  const preflightSamples: number[] = [];
  try {
    const batches = await Promise.all(
      accounts.map((account) => {
        const workerSlot = pickAccountWorkerSlot(account.id, workerCount);
        return (async () => {
          const tStart = Date.now();
          const pre = await preflightExecutionForAccount({
            opp,
            account,
            settings,
          });
          if (!pre.ok) return pre.rows;
          const queuedAtMs = Date.now();
          preflightSamples.push(queuedAtMs - tStart);
          return runAccountWorkerExclusive(account.id, workerSlot, async () => {
            const mutexAcquiredMs = Date.now();
            const queueWaitMs = mutexAcquiredMs - queuedAtMs;
            queueWaitSamples.push(queueWaitMs);
            if (queueWaitMs >= 5_000) {
              logger.info('[execution] queue wait before lock', {
                oppId,
                accountId: account.id,
                workerSlot,
                queueWaitMs,
                parentId: opp.signal.parentId,
              });
            }
            const signalAgeMs = mutexAcquiredMs - opp.signal.receivedAtMs;
            const maxSignalAgeMs = executionEnv.maxQueuedSignalAgeMs;
            if (maxSignalAgeMs > 0 && signalAgeMs > maxSignalAgeMs) {
              const ts = Date.now();
              logger.info('[execution] stale after queue — skip browser', {
                oppId,
                accountId: account.id,
                workerSlot,
                signalAgeMs,
                maxQueuedSignalAgeMs: maxSignalAgeMs,
                queueWaitMs,
              });
              return [
                {
                  accountId: account.id,
                  stake: 0,
                  status: 'skipped' as const,
                  reason: 'stale_after_queue',
                  latencyMs: ts - tStart,
                  finishedAtMs: ts,
                },
              ];
            }
            /** Budget must start after the mutex — otherwise queue wait burns the whole window and `page.goto` gets sub‑second timeouts. */
            const budget = new ExecutionBudget(settings.maxExecutionMs);
            return executeBrowserForAccount({
              opp,
              account,
              settings,
              budget,
              nav,
              stakes: pre.stakes,
              softIsMock: pre.softIsMock,
              probeIsSignalOnly: pre.probeIsSignalOnly,
              t0: tStart,
              workerSlot,
            });
          });
        })();
      }),
    );
    accountResults = batches.flat();
  } catch (e) {
    logger.error('[execution] unexpected', {
      err: e instanceof Error ? e.message : String(e),
    });
  }

  const finishedAtMs = Date.now();
  const outcome = outcomeFromAccountRows(accountResults);
  const maxQueueWaitMs =
    queueWaitSamples.length > 0 ? Math.max(...queueWaitSamples) : undefined;
  const maxPreflightMs =
    preflightSamples.length > 0 ? Math.max(...preflightSamples) : undefined;
  const result: BetExecutionResult = {
    opportunityId: oppId,
    parentId: opp.signal.parentId,
    startedAtMs,
    finishedAtMs,
    totalLatencyMs: finishedAtMs - startedAtMs,
    ...buildDropTimingSnapshot(opp, startedAtMs, finishedAtMs, accountResults),
    globalPass: globalPassFromOutcome(outcome),
    outcome,
    accountResults,
    maxQueueWaitMs,
    maxPreflightMs,
  };
  appendExecutionLog(result);

  return result;
}

export { buildDefaultExecutionSettings };
