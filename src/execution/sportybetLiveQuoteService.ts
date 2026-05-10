import { getAccounts } from '../account/accountManager.js';
import { executionEnv } from '../config/executionEnv.js';
import { buildDefaultExecutionSettings } from '../filters/filterEngine.js';
import { ExecutionBudget } from '../risk/riskManager.js';
import { logger } from '../utils/logger.js';
import { runSerial } from '../utils/serialQueue.js';
import type { OddsDropSignal } from '../types/index.js';
import { probeSportyBetLiveOddsFromNav } from './directSportyBetNav.js';
import { mapSignalToSportyBetKey } from './marketMapper.js';
import { ensureLoggedInSportyBet } from './sessionManager.js';

/**
 * One global queue — avoids dozens of concurrent SportyBet tabs during signal bursts.
 */
const LIVE_QUOTE_QUEUE = 'sportybet:live_soft_quote';

/**
 * Opens SportyBet (first enabled account, dedicated worker slot), navigates to the event/market,
 * and reads the displayed decimal odds for `side`.
 */
export async function probeSportyBetDecimalOdds(params: {
  signal: OddsDropSignal;
  side: 'over' | 'under';
}): Promise<number | undefined> {
  return runSerial(LIVE_QUOTE_QUEUE, async () => {
    const accounts = getAccounts().filter((a) => a.enabled !== false);
    if (accounts.length === 0) {
      logger.warn('[sportybet-live] no enabled accounts — cannot read live odds');
      return undefined;
    }

    const account = accounts[0]!;
    const settings = buildDefaultExecutionSettings();
    const cap = Math.min(executionEnv.maxExecutionMs, executionEnv.sportyBetLiveQuoteBudgetMs);
    const budget = new ExecutionBudget(cap);
    const key = mapSignalToSportyBetKey(params.signal);

    try {
      const page = await ensureLoggedInSportyBet({
        account,
        headless: settings.headless,
        budget,
        workerSlot: executionEnv.sportyBetLiveQuoteWorkerSlot,
      });

      const odds = await probeSportyBetLiveOddsFromNav({
        page,
        baseUrl: settings.sportyBetBaseUrl,
        key,
        side: params.side,
        budget,
      });

      if (odds != null && odds > 1 && Number.isFinite(odds)) {
        logger.info('[sportybet-live] quoted', {
          odds,
          side: params.side,
          accountId: account.id,
          parentId: params.signal.parentId,
        });
        return Math.round(odds * 1000) / 1000;
      }
      logger.info('[sportybet-live] unreadable odds from page', {
        odds,
        parentId: params.signal.parentId,
      });
      return undefined;
    } catch (e) {
      logger.warn('[sportybet-live] probe failed', {
        err: e instanceof Error ? e.message : String(e),
        parentId: params.signal.parentId,
      });
      return undefined;
    }
  });
}
