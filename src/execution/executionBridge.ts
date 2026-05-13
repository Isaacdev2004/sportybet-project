import { executionEnv } from '../config/executionEnv.js';
import { logger } from '../utils/logger.js';
import type { BettingOpportunity } from '../types/index.js';
import type { BetExecutionResult } from './types.js';
import { executeBetsOnOpportunity } from './betExecutor.js';
import { appendActivityEvent } from '../state/activityEventStore.js';

/**
 * Fire-and-forget Phase 2 execution after Phase 1 alerting.
 * Disabled unless EXECUTION_ENABLED=true.
 */
export function enqueueAutomatedExecution(opportunity: BettingOpportunity): void {
  if (!executionEnv.enabled) return;

  const pid = opportunity.signal.parentId ?? '?';
  const ev = opportunity.evPercent;
  appendActivityEvent({
    source: 'execution',
    level: 'info',
    headline: 'Execution queued',
    detail: `parent ${pid} · EV ${Number.isFinite(ev) ? ev.toFixed(2) : '?'}% · ${opportunity.signal.sport ?? 'sport ?'}`,
  });

  void executeBetsOnOpportunity(opportunity)
    .then((r: BetExecutionResult) => {
      logger.info('[execution] completed', {
        opportunityId: r.opportunityId,
        ms: r.totalLatencyMs,
        skip: r.skipReason,
        results: r.accountResults.length,
        outcome: r.outcome,
        dropToExecutionStartMs: r.dropToExecutionStartMs,
        dropToExecutionFinishedMs: r.dropToExecutionFinishedMs,
        dropToFirstPlacementMs: r.dropToFirstPlacementMs,
        maxQueueWaitMs: r.maxQueueWaitMs,
        maxPreflightMs: r.maxPreflightMs,
      });
      const ok = r.accountResults.filter((x) => x.status === 'success').length;
      appendActivityEvent({
        source: 'execution',
        level: r.outcome === 'placed' || r.outcome === 'partial' ? 'ok' : 'info',
        headline: `Execution finished · ${r.outcome}`,
        detail: `${r.skipReason ? `${r.skipReason} · ` : ''}${ok}/${r.accountResults.length} accounts placed OK · ${r.totalLatencyMs}ms`,
      });
    })
    .catch((e: unknown) => {
      logger.error('[execution] rejected', {
        err: e instanceof Error ? e.message : String(e),
      });
      appendActivityEvent({
        source: 'execution',
        level: 'error',
        headline: 'Execution crashed',
        detail: e instanceof Error ? e.message : String(e),
      });
    });
}
