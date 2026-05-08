import type {
  DecisionOutcome,
  ExpectedValueResult,
  FullMarketQuote,
  OddsDropSignal,
  SkipReason,
} from '../types/index.js';
import type { FilterConfig } from '../config/filters.js';
import { sportPassesAllowlist } from '../config/filters.js';

function normLeague(l?: string): string {
  return (l ?? '').trim().toLowerCase();
}

/** Minimum window per sport so tennis (long matches) is not cut off by a single default. */
function sportPlayableWindowCeilingMinutes(
  configured: number,
  sport?: string,
  league?: string,
): number {
  const blob = `${sport ?? ''} ${league ?? ''}`.toLowerCase();
  if (/tennis|\batp\b|\bwta\b|\bdoubles\b|\bchallenger\b/.test(blob)) {
    return Math.max(configured, 320);
  }
  if (
    /\bbasketball\b|\bnba\b|\bwnba\b|\bpba\b|\beuroleague\b|\bacb\b|\bfiba\b|\bbleague\b|\bg[\s-]?league\b|\bgleague\b|\bnbbl\b|ncaa.*bask/i.test(
      blob,
    )
  ) {
    return Math.max(configured, 220);
  }
  return configured;
}

/**
 * Drops often omit `is_live`; use conservative row hints so timeline + FILTER_REQUIRE_EXPLICIT_LIVE can still pass.
 */
function dropHintsLikelyInPlay(signal: OddsDropSignal): boolean {
  const h = signal.liveHomeScore;
  const a = signal.liveAwayScore;
  const scoreNumeric =
    (typeof h === 'number' && Number.isFinite(h)) ||
    (typeof a === 'number' && Number.isFinite(a));
  const nonzeroScore =
    (typeof h === 'number' && Number.isFinite(h) && h > 0) ||
    (typeof a === 'number' && Number.isFinite(a) && a > 0);
  /** Non‑zero avoids 0‑0 prematch stubs; pairing with numeric clock lowers false positives. */
  const scoreHint =
    nonzeroScore ||
    (scoreNumeric && /\d/.test(String(signal.matchClock ?? '').trim()));

  const p = signal.period;
  if (p !== undefined && p > 0) return true;

  const pn = (signal.periodName ?? '').trim();
  if (
    pn &&
    /\b(set|half|quarter|period|inning|ot\b|shootout|extra)\b|\d\s*(?:st|nd|rd|th)\s+set/i.test(
      pn,
    )
  ) {
    return true;
  }

  const ck = String(signal.matchClock ?? '').trim();
  if (ck && /\d/.test(ck) && ck.length <= 48) return true;

  return scoreHint;
}

/**
 * Block prematch, likely-finished (late settlement moves), and explicit not-live.
 * When `starts` is missing, does not infer finish time — relies on explicit live flags
 * (and timeline rules). Conservative row hints apply only when `FILTER_REQUIRE_EXPLICIT_LIVE=false`.
 */
export function resolveAlertLiveGate(
  signal: OddsDropSignal,
  pinnacle: FullMarketQuote,
  filters: FilterConfig,
): SkipReason | undefined {
  const explicitLive = signal.isLive === true || pinnacle.isLive === true;
  const anyExplicitFalse =
    signal.isLive === false || pinnacle.isLive === false;
  const hints = dropHintsLikelyInPlay(signal);
  /** Timeline bypass: hints only when live flag is not required (otherwise need `isLive: true`). */
  const treatAsInPlayTimeline =
    explicitLive || (!filters.requireExplicitLive && hints);

  const nowSec = Date.now() / 1000;
  const start = signal.eventStartUnixSec;

  if (filters.maxPlayableWindowMinutes > 0 && start && Number.isFinite(start)) {
    if (nowSec < start && !treatAsInPlayTimeline) return 'not_live';

    const elapsedMin = (nowSec - start) / 60;
    const cap = sportPlayableWindowCeilingMinutes(
      filters.maxPlayableWindowMinutes,
      signal.sport ?? pinnacle.sport,
      signal.league ?? pinnacle.league,
    );
    if (!treatAsInPlayTimeline && elapsedMin > cap)
      return 'event_likely_finished';
  }

  if (explicitLive) return undefined;

  if (anyExplicitFalse) return 'not_live';

  /** When set, score/period/clock hints are not enough — need `signal` or `pinnacle` `isLive: true`. */
  if (filters.requireExplicitLive && !explicitLive) return 'not_live';

  return undefined;
}

/** Relative drop magnitude on the alerted side (absolute % change). */
export function signalDropPercent(signal: OddsDropSignal): number | undefined {
  const { prevOdds, currentOdds } = signal;
  if (!(prevOdds && currentOdds) || prevOdds <= 1 || currentOdds <= 1) return undefined;
  return (Math.abs(currentOdds - prevOdds) / prevOdds) * 100;
}

/**
 * Core gating: live only, league/sport filters, EV floor, optional drop & freshness.
 */
export function evaluateOpportunity(params: {
  filters: FilterConfig;
  signal: OddsDropSignal;
  pinnacle: FullMarketQuote;
  ev?: ExpectedValueResult;
  hasSoftMatch: boolean;
}): DecisionOutcome {
  const { filters, signal, pinnacle, ev, hasSoftMatch } = params;
  const now = Date.now();
  if (now - signal.receivedAtMs > filters.maxSignalAgeMs) {
    return { pass: false, reason: 'signal_too_old' };
  }

  const liveBlock = resolveAlertLiveGate(signal, pinnacle, filters);
  if (liveBlock) {
    return { pass: false, reason: liveBlock };
  }

  const league = normLeague(pinnacle.league ?? signal.league);
  if (league && filters.excludedLeagues.has(league)) {
    return { pass: false, reason: 'league_excluded' };
  }

  if (
    filters.allowedSports.size > 0 &&
    !sportPassesAllowlist(
      signal.sport ?? pinnacle.sport,
      filters.allowedSports,
      signal.league ?? pinnacle.league,
    )
  ) {
    return { pass: false, reason: 'sport_not_allowed' };
  }

  if (!hasSoftMatch) {
    return { pass: false, reason: 'no_soft_match' };
  }

  if (!ev || !Number.isFinite(ev.evPercent)) {
    return { pass: false, reason: 'invalid_odds' };
  }
  if (ev.evPercent < filters.minEvPercent) {
    return { pass: false, reason: 'below_min_ev' };
  }

  if (filters.minDropPercent > 0) {
    const d = signalDropPercent(signal);
    if (d === undefined || d < filters.minDropPercent) {
      return { pass: false, reason: 'drop_below_threshold' };
    }
  }

  return { pass: true };
}

export function summarizeSkip(reason: SkipReason | undefined): string {
  switch (reason) {
    case 'below_min_ev':
      return 'EV below configured minimum';
    case 'drop_below_threshold':
      return 'Odds movement smaller than configured drop threshold';
    case 'fetch_market_failed':
      return 'Could not load full market from Pinnacle REST';
    case 'invalid_odds':
      return 'Odds EV could not be computed';
    case 'league_excluded':
      return 'League excluded by filters';
    case 'missing_parent_id':
      return 'Signal missing parent / event id';
    case 'no_soft_match':
      return 'No matching SportyBet line';
    case 'not_live':
      return 'Market not live or before kickoff';
    case 'signal_too_old':
      return 'Signal older than configured window';
    case 'sport_not_allowed':
      return 'Sport not in allowlist';
    case 'event_likely_finished':
      return 'Event likely finished (past playable window from scheduled start)';
    default:
      return 'Unknown / unset';
  }
}
