import { executionEnv } from '../config/executionEnv.js';
import type { OddsDropSignal } from '../types/index.js';
import { fetchSportyBetQuoteFromApi } from '../services/sportybetApiClient.js';

/** Live odds probe — API when configured, else signal anchor until Playwright page read. */
export async function fetchSportyBetLiveOddsForProbe(params: {
  baseUrl: string;
  signal: OddsDropSignal;
  expectedSide: 'over' | 'under';
}): Promise<{ odds: number; source: string } | undefined> {
  if (executionEnv.sportyBetOddsSource === 'api') {
    const api = await fetchSportyBetQuoteFromApi({
      signal: params.signal,
      side: params.expectedSide,
    });
    if (api) return api;
  }

  void params.baseUrl;
  const fromSignal =
    typeof params.signal.currentOdds === 'number' &&
    Number.isFinite(params.signal.currentOdds)
      ? params.signal.currentOdds
      : undefined;
  if (fromSignal && fromSignal > 1) {
    return { odds: fromSignal, source: 'signal_anchor' };
  }
  return undefined;
}
