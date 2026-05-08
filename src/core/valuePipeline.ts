import { env } from '../config/env.js';
import { filters } from '../config/filters.js';
import type {
  BettingOpportunity,
  FullMarketQuote,
  OddsDropSignal,
} from '../types/index.js';
import {
  computeEvAgainstNvp,
  computeEvFromProviderFairOdds,
  inferAlignFromSoftOdds,
  inferMoneylineAlignFromSignal,
  pickAlignSide,
} from './evCalculator.js';
import {
  evaluateOpportunity,
  signalDropPercent,
  summarizeSkip,
} from './decisionEngine.js';
import {
  fetchFullMarket,
  type MarketFetchHints,
} from './oddsFetcher.js';
import { buildFairPrices } from './nvpCalculator.js';
import {
  fetchSportyBetQuote,
  STUB_MATCH_CONTEXT_PROVIDER_NVP,
} from '../services/sportybetService.js';
import { sendBettingAlert } from '../services/telegramService.js';
import { logger } from '../utils/logger.js';
import type { RecentStore } from '../state/recentStore.js';
import { enqueueAutomatedExecution } from '../execution/executionBridge.js';

export function formatOddsMovement(signal: OddsDropSignal): string {
  const prev = signal.prevOdds ?? '?';
  const cur = signal.currentOdds ?? '?';
  return `${prev} → ${cur}`;
}

function buildProviderNvpStubQuote(signal: OddsDropSignal): FullMarketQuote {
  const line = signal.line;
  const pin = signal.currentOdds ?? signal.prevOdds ?? 2;
  const anchor =
    typeof pin === 'number' && Number.isFinite(pin) && pin > 1 ? pin : 2;
  return {
    parentId: signal.parentId ?? '0',
    sport: signal.sport,
    league: signal.league,
    home: signal.home,
    away: signal.away,
    market: signal.market,
    /** Do not infer live from NVP stubs — gated via `starts` + `resolveAlertLiveGate`. */
    isLive: signal.isLive,
    matchContext: STUB_MATCH_CONTEXT_PROVIDER_NVP,
    over: { designation: 'over', odds: anchor, line },
    under: { designation: 'under', odds: anchor, line },
  };
}

/**
 * Async hot path — each signal is isolated; failures are logged, never thrown from the worker.
 */
export async function processOddsSignal(
  signal: OddsDropSignal,
  store?: RecentStore,
): Promise<void> {
  store?.recordSignal(signal);
  logger.info('[pipeline] signal accepted', {
    parentId: signal.parentId,
    league: signal.league,
    market: signal.market,
    sport: signal.sport,
    nvpFeed: signal.providerNvp,
    prev: signal.prevOdds,
    cur: signal.currentOdds,
  });

  try {
    if (!signal.parentId) {
      logger.info('[pipeline] skipped', {
        reason: summarizeSkip('missing_parent_id'),
      });
      return;
    }

    const hints: MarketFetchHints = {
      period: signal.period,
      line: signal.line,
      marketLabel: [signal.market, signal.sector].filter(Boolean).join(' '),
      designation: signal.designation,
    };

    /** PinnOdds attaches `nvp` on most drop types (moneyline, spread, totals). Skip /details whenever we trust feed fair price. */
    const useFeedNvp =
      env.pinnacle.preferProviderNvp &&
      typeof signal.providerNvp === 'number' &&
      signal.providerNvp > 1;

    let pinnacle: FullMarketQuote | undefined;
    if (useFeedNvp) {
      pinnacle = buildProviderNvpStubQuote(signal);
      logger.debug('[pipeline] PinnOdds feed NVP — skip /details for dewag', {
        providerNvp: signal.providerNvp,
        parentId: signal.parentId,
      });
    } else {
      pinnacle = await fetchFullMarket(signal.parentId, hints);
    }

    if (!pinnacle) {
      logger.info('[pipeline] skipped', {
        reason: summarizeSkip('fetch_market_failed'),
      });
      return;
    }

    const soft = await fetchSportyBetQuote({ signal, pinnacle });

    if (!soft) {
      const dec = evaluateOpportunity({
        filters,
        signal,
        pinnacle,
        hasSoftMatch: false,
      });
      logger.info('[pipeline] skipped', {
        reason: summarizeSkip(dec.reason),
      });
      return;
    }

    let evResult;
    try {
      if (
        useFeedNvp &&
        typeof signal.providerNvp === 'number' &&
        signal.providerNvp > 1
      ) {
        const align =
          pickAlignSide(soft.designation) ??
          pickAlignSide(signal.designation) ??
          inferMoneylineAlignFromSignal(signal) ??
          'over';
        evResult = computeEvFromProviderFairOdds({
          fairDecimalOdds: signal.providerNvp,
          softOdds: soft.odds,
          align,
        });
      } else {
        const fair = buildFairPrices(pinnacle);
        const align =
          pickAlignSide(soft.designation) ??
          pickAlignSide(signal.designation) ??
          inferAlignFromSoftOdds(soft.odds, pinnacle);
        evResult = computeEvAgainstNvp({
          fair,
          softOdds: soft.odds,
          align,
        });
      }
    } catch (e) {
      logger.warn('[pipeline] NVP/EV compute failed', {
        err: e instanceof Error ? e.message : String(e),
      });
      const dec = evaluateOpportunity({
        filters,
        signal,
        pinnacle,
        hasSoftMatch: true,
        ev: undefined,
      });
      logger.info('[pipeline] skipped', {
        reason: summarizeSkip(dec.reason),
      });
      return;
    }

    const dec = evaluateOpportunity({
      filters,
      signal,
      pinnacle,
      ev: evResult,
      hasSoftMatch: true,
    });

    if (!dec.pass) {
      logger.info('[pipeline] skipped', {
        reason: summarizeSkip(dec.reason),
        evPercent: evResult.evPercent,
        dropPct: signalDropPercent(signal),
      });
      return;
    }

    const opportunity: BettingOpportunity = {
      ...evResult,
      signal,
      pinnacle,
      softBookLabel: soft.book,
      formattedMovement: formatOddsMovement(signal),
    };

    store?.recordOpportunity(opportunity);
    logger.info('[pipeline] VALUE OPPORTUNITY', {
      ev: opportunity.evPercent,
      league: opportunity.pinnacle.league,
      fairFromFeed: Boolean(useFeedNvp),
    });

    void sendBettingAlert(opportunity);
    enqueueAutomatedExecution(opportunity);
  } catch (e) {
    logger.error('[pipeline] unexpected failure (isolated)', {
      err: e instanceof Error ? e.message : String(e),
    });
  }
}
