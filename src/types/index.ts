/**
 * Canonical types for SSE drops, fetched markets, and pipeline decisions.
 * Field names tolerate multiple provider payloads via optional aliases in parsers.
 */

export type SportKey = string;
export type LeagueKey = string;

/** Parsed movement from SSE (normalized). */
export interface OddsDropSignal {
  /** Raw payload for debugging / audit */
  raw: unknown;
  receivedAtMs: number;
  sport?: string;
  league?: string;
  /** Home participant name */
  home?: string;
  /** Away participant name */
  away?: string;
  market?: string;
  /** Spread / totals line as string when applicable */
  line?: string | number;
  /** e.g. over | under | home | away */
  designation?: string;
  prevOdds?: number;
  currentOdds?: number;
  /** Provider event / market parent identifier */
  parentId?: string;
  /** PinnOdds / Arcadia period index (0 = full game, 1 = 1st half or Set 1, …) */
  period?: number;
  /** Vendor label when present (`period_name`), e.g. `Game`, `3rd Set` — preferred over numeric `period`. */
  periodName?: string;
  /** PinnOdds SSE field `sect` (e.g. Moneyline) when `market` is absent */
  sector?: string;
  /** Explicit live flag from payload when present */
  isLive?: boolean;
  /**
   * PinnOdds often ships `nvp` on drops (moneyline / spread / totals). When trusted, /details dewag can be skipped.
   */
  providerNvp?: number;
  /** Drop window from feed (`interval`); interpreted as seconds when vendor documents as such */
  dropIntervalSecs?: number;
  /** In-play scores when the drop payload exposes them */
  liveHomeScore?: number;
  liveAwayScore?: number;
  /** Match clock label if present on the payload */
  matchClock?: string;
  /** Posted limit / max stake when available */
  stakeLimit?: number | string;
  /**
   * Scheduled event start (Unix **seconds**). PinnOdds drops use `starts`.
   * Used to suppress alerts long after tip-off (settlements / noisy late moves).
   */
  eventStartUnixSec?: number;
}

/** Single outcome side for a market (e.g. over / under). */
export interface MarketSide {
  designation: string;
  odds: number;
  line?: string | number;
}

/** Full market with both sides — required for NVP. */
export interface FullMarketQuote {
  parentId: string;
  sport?: string;
  league?: string;
  home?: string;
  away?: string;
  market?: string;
  isLive?: boolean;
  /** Match clock / score text when available */
  matchContext?: string;
  over: MarketSide;
  under: MarketSide;
}

export interface FairPrices {
  /** No-vig decimal odds for over (proportional dewag). */
  nvpOver: number;
  /** No-vig decimal odds for under. */
  nvpUnder: number;
  /** Normalized true probability for over (0–1). */
  trueProbOver: number;
  /** Normalized true probability for under (0–1). */
  trueProbUnder: number;
}

export interface ExpectedValueResult {
  /** Soft book decimal odds matched to the pinnacle side */
  softOdds: number;
  /** Fair (no-vig) decimal odds from Pinnacle two-way market */
  nvpUsed: number;
  /** Which pinnacle side aligned with the soft quote */
  side: 'over' | 'under';
  evPercent: number;
}

export type SkipReason =
  | 'not_live'
  | 'missing_parent_id'
  | 'league_excluded'
  | 'sport_not_allowed'
  | 'below_min_ev'
  | 'no_soft_match'
  | 'fetch_market_failed'
  | 'drop_below_threshold'
  | 'signal_too_old'
  | 'invalid_odds'
  | 'event_likely_finished';

export interface DecisionOutcome {
  pass: boolean;
  reason?: SkipReason;
}

export interface BettingOpportunity extends ExpectedValueResult {
  signal: OddsDropSignal;
  pinnacle: FullMarketQuote;
  softBookLabel: string;
  formattedMovement: string;
}
