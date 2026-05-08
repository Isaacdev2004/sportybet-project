import type { BettingOpportunity, OddsDropSignal } from '../types/index.js';
import type {
  AccountFilters,
  ExecutionAccount,
  ExecutionSettings,
  GlobalExecutionFilters,
  ScenarioFilter,
} from '../execution/types.js';
import { executionEnv } from '../config/executionEnv.js';
import { signalDropPercent } from '../core/decisionEngine.js';
import { sportPassesAllowlist } from '../config/filters.js';

function scenarioFromSignal(signal: OddsDropSignal): ScenarioFilter {
  const m = `${signal.market ?? ''} ${signal.sector ?? ''}`.toLowerCase();
  if (m.includes('team') && m.includes('total')) return 'team_total';
  if (m.includes('total')) return 'total';
  if (m.includes('spread') || m.includes('handicap')) return 'spread';
  if (m.includes('money') || m.includes('winner') || m.includes('ml')) return 'moneyline';
  return 'other';
}

function directionMatches(
  filter: AccountFilters['direction'],
  designation: string | undefined,
): boolean {
  if (filter === 'both') return true;
  const d = (designation ?? '').toLowerCase();
  if (filter === 'over') return d.includes('over') || d.includes('home');
  if (filter === 'under') return d.includes('under') || d.includes('away');
  return true;
}

export function buildDefaultExecutionSettings(): ExecutionSettings {
  return {
    enabled: executionEnv.enabled,
    maxExecutionMs: executionEnv.maxExecutionMs,
    dedupTtlMs: executionEnv.dedupTtlMs,
    maxOddsDrift: executionEnv.maxOddsDrift,
    global: {
      minEvPercent: executionEnv.globalMinEv,
      maxEvPercent: executionEnv.globalMaxEv,
      minDropPercent: executionEnv.globalMinDropPct,
      maxDropPercent: executionEnv.globalMaxDropPct,
      minNvp: executionEnv.globalMinNvp,
      maxNvp: executionEnv.globalMaxNvp,
      enabledScenarios: executionEnv.globalScenarios as ScenarioFilter[],
    },
    headless: executionEnv.headless,
    sportyBetBaseUrl: executionEnv.sportyBetBaseUrl,
  };
}

export function passGlobalExecutionFilters(
  opp: BettingOpportunity,
  g: GlobalExecutionFilters,
): { ok: boolean; reason?: string } {
  if (opp.evPercent < g.minEvPercent || opp.evPercent > g.maxEvPercent) {
    return { ok: false, reason: 'ev_out_of_range' };
  }
  const d = signalDropPercent(opp.signal);
  if (d !== undefined) {
    if (d < g.minDropPercent || d > g.maxDropPercent) {
      return { ok: false, reason: 'drop_pct_out_of_range' };
    }
  }
  if (opp.nvpUsed < g.minNvp || opp.nvpUsed > g.maxNvp) {
    return { ok: false, reason: 'nvp_out_of_range' };
  }
  const scen = scenarioFromSignal(opp.signal);
  if (!g.enabledScenarios.includes(scen)) {
    return { ok: false, reason: 'scenario_not_enabled' };
  }
  return { ok: true };
}

export function passAccountExecutionFilters(
  account: ExecutionAccount,
  opp: BettingOpportunity,
): { ok: boolean; reason?: string } {
  const f = account.filters;
  const sportKey = opp.signal.sport ?? opp.pinnacle.sport ?? '';
  const leagueKey = opp.signal.league ?? opp.pinnacle.league;
  if (
    f.allowedSports.length > 0 &&
    !sportPassesAllowlist(sportKey, new Set(f.allowedSports.map((s) => s.toLowerCase())), leagueKey)
  ) {
    return { ok: false, reason: 'account_sport_blocked' };
  }
  const scen = scenarioFromSignal(opp.signal);
  if (!f.scenarios.includes(scen)) {
    return { ok: false, reason: 'account_scenario_blocked' };
  }
  if (!directionMatches(f.direction, opp.signal.designation)) {
    return { ok: false, reason: 'account_direction_blocked' };
  }
  const minEv = f.minEvPercent ?? 0;
  if (opp.evPercent < minEv) {
    return { ok: false, reason: 'account_min_ev' };
  }
  return { ok: true };
}
