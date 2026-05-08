import { env } from './env.js';

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function parseList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function normalizeSportKey(s: string): string {
  return s.trim().toLowerCase();
}

function basketballLike(s: string): boolean {
  if (
    /\bnba\b|\bwnba\b|\bcbb\b|\beuroleague\b|\bg[\s-]?league\b|\bacb\b|\beurocup\b|\bbaloncesto\b/i.test(
      s,
    ) ||
    (s.includes('ncaa') && s.includes('basket')) ||
    /national\s+basketball/i.test(s)
  ) {
    return true;
  }
  return (
    s.includes('basketball') || s.includes('basket ball') || s === 'nba' || s === 'wnba'
  );
}

function tennisLike(s: string): boolean {
  return s.includes('tennis');
}

function basketballLeagueHints(leagueRaw?: string): boolean {
  const l = (leagueRaw ?? '').trim().toLowerCase();
  if (!l) return false;
  return (
    /\bnba\b|\bwnba\b|\beuroleague\b|\beuro cup\b|\bacb\b|\bncaa\b.*\bbask|\bfiba\b|\bg[\s-]?league\b|\bbig3\b/i.test(
      l,
    ) || l.includes('nba ') || l.startsWith('nba')
  );
}

function tennisLeagueHints(leagueRaw?: string): boolean {
  const l = (leagueRaw ?? '').trim().toLowerCase();
  if (!l) return false;
  return (
    /\batp\b|\bwta\b|\bitf\b|\bchallenger\b|\bus open\b|\bwimbledon\b|\broland garros\b|\baustralian open\b|\bfrench open\b/i.test(
      l,
    ) || l.includes('tennis')
  );
}

/**
 * True when `sportRaw` matches the configured allow list (exact or common feed aliases).
 */
export function sportPassesAllowlist(
  sportRaw: string | undefined,
  allowed: Set<string>,
  leagueHint?: string,
): boolean {
  if (allowed.size === 0) return true;
  const s = (sportRaw ?? '').trim().toLowerCase();
  /** Feed sometimes omits sport; do not treat as excluded (legacy behaviour). */
  if (!s && !leagueHint?.trim()) return true;
  if (s && allowed.has(s)) return true;
  if (allowed.has('basketball')) {
    if (basketballLike(s)) return true;
    if (basketballLeagueHints(leagueHint)) return true;
  }
  if (allowed.has('tennis')) {
    if (tennisLike(s)) return true;
    if (tennisLeagueHints(leagueHint)) return true;
  }
  return false;
}

/**
 * Betting filters driven by env (see .env.example). Defaults match spec.
 */
export interface FilterConfig {
  minEvPercent: number;
  excludedLeagues: Set<string>;
  allowedSports: Set<string>;
  /** Minimum relative drop on the signal (0 = disabled). */
  minDropPercent: number;
  /** Drop older than this is ignored. */
  maxSignalAgeMs: number;
  /**
   * 0 = off. Otherwise: if `starts` exists on the drop, skip alerts when `now`
   * is earlier than kickoff (`not_live`), or later than kickoff plus this window
   * (`event_likely_finished` — clamps late settlement noise).
   */
  maxPlayableWindowMinutes: number;
  /**
   * When true, skip unless the SSE signal or Pinnacle `/details` has `isLive: true`.
   * Period/score/clock hints do not qualify. Prevents alerts on prematch or ambiguous rows.
   */
  requireExplicitLive: boolean;
}

export function loadFilters(): FilterConfig {
  const minEv = Number(process.env.FILTER_MIN_EV_PERCENT ?? '4');
  const minDrop = Number(process.env.FILTER_MIN_DROP_PERCENT ?? '0');
  const maxAge = Number(process.env.FILTER_SIGNAL_MAX_AGE_MS ?? '60000');

  const excluded = new Set(
    parseList(process.env.FILTER_EXCLUDED_LEAGUES ?? '').map((s) =>
      s.toLowerCase(),
    ),
  );
  const allowedRaw = parseList(
    process.env.FILTER_ALLOWED_SPORTS ?? 'tennis,basketball',
  );
  const allowed = new Set(allowedRaw.map(normalizeSportKey));

  const playableWindowEnv = Number(
    process.env.FILTER_MAX_PLAYABLE_WINDOW_MINUTES ?? '240',
  );
  const maxPlayableWindowMinutes =
    Number.isFinite(playableWindowEnv) && playableWindowEnv >= 0
      ? Math.floor(playableWindowEnv)
      : 240;

  const requireExplicitLive = envBool(process.env.FILTER_REQUIRE_EXPLICIT_LIVE);

  return {
    minEvPercent: Number.isFinite(minEv) ? minEv : 4,
    excludedLeagues: excluded,
    allowedSports: allowed,
    minDropPercent: Number.isFinite(minDrop) ? Math.max(0, minDrop) : 0,
    maxSignalAgeMs: Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 60_000,
    maxPlayableWindowMinutes,
    requireExplicitLive,
  };
}

/**
 * Resolved filters singleton for hot path (reload on restart / deploy).
 */
export const filters = loadFilters();

export { env };
