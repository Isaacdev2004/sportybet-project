import type { Page } from 'playwright';

import { executionEnv } from '../config/executionEnv.js';
import type { SportyBetMarketKey } from './types.js';
import type { ExecutionBudget } from '../risk/riskManager.js';
import {
  navigateDirectLiveFlow,
  placeBet,
  type DirectNavOutcome,
} from './directSportyBetNav.js';

export type { DirectNavOutcome };

export interface NavigateToMarketParams {
  page: Page;
  key: SportyBetMarketKey;
  budget: ExecutionBudget;
  side: 'over' | 'under';
  softOdds: number;
  maxOddsDrift: number;
  /** Skip SportyBet DOM odds vs softOdds check (mock book or signal-only probe). */
  skipOnPageOddsCompare?: boolean;
}

/**
 * SportyBet navigation — **direct path only**: Sport → Live → row match → market → stake.
 * No search, no booking code. See `directSportyBetNav.ts`.
 */
export class NavigationEngine {
  private readonly baseUrl: string;

  constructor(baseUrl: string = executionEnv.sportyBetBaseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async navigateToMarket(
    params: NavigateToMarketParams,
  ): Promise<DirectNavOutcome> {
    const { page, key, budget, side, softOdds, maxOddsDrift, skipOnPageOddsCompare } =
      params;
    return navigateDirectLiveFlow({
      page,
      baseUrl: this.baseUrl,
      key,
      side,
      softOdds,
      maxOddsDrift,
      skipOnPageOddsCompare: skipOnPageOddsCompare ?? false,
      budget,
    });
  }

  async fillStakeAndPlace(params: {
    page: Page;
    stake: number;
    budget: ExecutionBudget;
  }): Promise<{ ok: boolean; reason?: string }> {
    return placeBet(params.page, params.stake, params.budget);
  }
}
