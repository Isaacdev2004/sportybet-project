import type { OddsDropSignal } from '../types/index.js';

/** Live odds probe — replace with real HTTP scrape or internal API. */
export async function fetchSportyBetLiveOddsForProbe(params: {
  baseUrl: string;
  signal: OddsDropSignal;
  expectedSide: 'over' | 'under';
}): Promise<{ odds: number; source: string } | undefined> {
  void params.baseUrl;
  void params.expectedSide;
  /** Phase 2 placeholder: wire Playwright page.evaluate or mobile API. */
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
