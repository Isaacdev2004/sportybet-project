import { executionEnv } from '../config/executionEnv.js';
import { logger } from '../utils/logger.js';
import type { BettingOpportunity } from '../types/index.js';
import type { BetExecutionResult } from './types.js';
import { executeBetsOnOpportunity } from './betExecutor.js';

/**
 * Fire-and-forget Phase 2 execution after Phase 1 alerting.
 * Disabled unless EXECUTION_ENABLED=true.
 */
export function enqueueAutomatedExecution(opportunity: BettingOpportunity): void {
  if (!executionEnv.enabled) return;

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
      });
    })
    .catch((e: unknown) => {
      logger.error('[execution] rejected', {
        err: e instanceof Error ? e.message : String(e),
      });
    });
}
