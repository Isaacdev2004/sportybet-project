/**
 * Phase 2 — automated execution domain types (SportyBet + Pinnacle-aligned signals).
 */

import type { BettingOpportunity, OddsDropSignal } from '../types/index.js';

export type BetDirectionFilter = 'over' | 'under' | 'both';

export type ScenarioFilter =
  | 'total'
  | 'spread'
  | 'moneyline'
  | 'team_total'
  | 'other';

export interface StakeRange {
  min: number;
  max: number;
}

export interface AccountFilters {
  allowedSports: string[];
  scenarios: ScenarioFilter[];
  direction: BetDirectionFilter;
  /** Min EV for this account (overrides global if set) */
  minEvPercent?: number;
}

export interface ExecutionAccount {
  id: string;
  username: string;
  password: string;
  proxy?: string;
  stakeRanges: StakeRange[];
  startingBalance?: number;
  filters: AccountFilters;
  enabled?: boolean;
}

export interface GlobalExecutionFilters {
  minEvPercent: number;
  maxEvPercent: number;
  minDropPercent: number;
  maxDropPercent: number;
  minNvp: number;
  maxNvp: number;
  enabledScenarios: ScenarioFilter[];
}

export interface ExecutionSettings {
  enabled: boolean;
  maxExecutionMs: number;
  dedupTtlMs: number;
  /** Max drift between soft quote at decision vs live SportyBet (absolute odds diff). */
  maxOddsDrift: number;
  global: GlobalExecutionFilters;
  headless: boolean;
  sportyBetBaseUrl: string;
}

export type ExecutionOutcomeStatus =
  | 'success'
  | 'failed'
  | 'skipped'
  | 'partial';

export interface SingleBetResult {
  accountId: string;
  stake: number;
  status: ExecutionOutcomeStatus;
  reason?: string;
  latencyMs?: number;
  /** Wall-clock ms when this row finished (success = after place attempt returns). */
  finishedAtMs?: number;
}

/** Row in the execution log — use `outcome` for dashboards; avoid treating `globalPass` alone as “bet won”. */
export type ExecutionLogOutcome =
  | 'execution_off'
  | 'filtered_out'
  | 'dedup_skipped'
  | 'no_enabled_accounts'
  | 'placed'
  | 'partial'
  | 'failed'
  | 'all_skipped';

export interface BetExecutionResult {
  opportunityId: string;
  parentId?: string;
  startedAtMs: number;
  finishedAtMs: number;
  totalLatencyMs: number;
  /** When the drop was first received by this app (`signal.receivedAtMs`). */
  signalReceivedAtMs: number;
  /** Ms from signal receipt → `executeBetsOnOpportunity` start (pipeline + queue). */
  dropToExecutionStartMs: number;
  /** Ms from signal receipt → executor return. */
  dropToExecutionFinishedMs: number;
  /**
   * When ≥1 stake has `status: "success"`: ms from signal receipt → earliest placement completion.
   */
  dropToFirstPlacementMs?: number;
  /**
   * When ≥1 stake has `status: "success"`: ms from signal receipt → latest placement completion.
   */
  dropToLastPlacementMs?: number;
  /**
   * True only when at least one stake row has `status: "success"` (`outcome` is `placed` or `partial`).
   * False for global filter rejects, dedup, no accounts, all skips, or only failures.
   */
  globalPass: boolean;
  /** Why the executor stopped before account work (not mutually exclusive with `outcome`). */
  skipReason?: string;
  accountResults: SingleBetResult[];
  /** High-level result for this opportunity row. */
  outcome: ExecutionLogOutcome;
  /**
   * Diagnostics: max time any account waited for its Playwright worker lock (ms).
   * Large values mean bets are queued behind other runs — raise EXECUTION_ACCOUNT_WORKERS.
   */
  maxQueueWaitMs?: number;
  /**
   * Max time spent in preflight (filters + SportyBet odds probe) before queueing for browser (ms).
   */
  maxPreflightMs?: number;
}

export interface QualifiedExecutionSignal {
  opportunity: BettingOpportunity;
  signal: OddsDropSignal;
}

/** Resolved identity for SportyBet navigation / odds match. */
export interface SportyBetMarketKey {
  home: string;
  away: string;
  league: string;
  sport: string;
  sector: string;
  line?: string | number;
  designation: string;
  parentId: string;
}
