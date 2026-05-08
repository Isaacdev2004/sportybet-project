/** Optional live fields surfaced on vendor drop rows — best-effort; shapes vary by sport/SDK. */

function numFrom(keys: string[], bases: Record<string, unknown>[]): number | undefined {
  for (const base of bases) {
    if (!base) continue;
    for (const k of keys) {
      const v = base[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return undefined;
}

function strFrom(keys: string[], bases: Record<string, unknown>[]): string | undefined {
  for (const base of bases) {
    if (!base) continue;
    for (const k of keys) {
      const v = base[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
  }
  return undefined;
}

export function extractDropPayloadExtras(raw: Record<string, unknown>): {
  dropIntervalSecs?: number;
  liveHomeScore?: number;
  liveAwayScore?: number;
  matchClock?: string;
  stakeLimit?: number | string;
} {
  const meta =
    raw.meta && typeof raw.meta === 'object' ? (raw.meta as Record<string, unknown>) : undefined;
  const periodBlock =
    raw.period_meta && typeof raw.period_meta === 'object'
      ? (raw.period_meta as Record<string, unknown>)
      : undefined;
  const bases = [raw, meta, periodBlock].filter(Boolean) as Record<string, unknown>[];

  return {
    dropIntervalSecs: numFrom(
      [
        'interval',
        'interval_sec',
        'interval_seconds',
        'drop_interval',
        'drop_interval_sec',
        'window_sec',
      ],
      bases,
    ),
    liveHomeScore: numFrom(
      ['home_score', 'homeScore', 'score_home', 'h_score', 'homescore', 'live_home_score'],
      bases,
    ),
    liveAwayScore: numFrom(
      ['away_score', 'awayScore', 'score_away', 'a_score', 'awayscore', 'live_away_score'],
      bases,
    ),
    matchClock: strFrom(
      ['match_time', 'clock', 'time', 'minute', 'elapsed', 'game_clock', 'match_clock'],
      bases,
    ),
    stakeLimit: (() => {
      const n = numFrom(
        [
          'max_stake',
          'maxStake',
          'stake_limit',
          'limit',
          'max_limit',
          'max_bet',
          'max_bet_usd',
          'max',
        ],
        bases,
      );
      if (n !== undefined) return n;
      return strFrom(['stake_currency', 'max_stake_currency'], bases);
    })(),
  };
}
