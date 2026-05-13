import type { BettingOpportunity, OddsDropSignal } from '../types/index.js';
import type { IndividualFilterRule } from './individualFilterTypes.js';
import { sportPassesAllowlist } from '../config/filters.js';
import { scenarioFromSignal } from './filterEngine.js';
import { getIndividualFilters } from '../state/individualFiltersStore.js';

export function resolveIndividualFilterMode(opp: BettingOpportunity): 'inplay' | 'prematch' {
  if (opp.signal.isLive === true || opp.pinnacle.isLive === true) return 'inplay';
  return 'prematch';
}

function parseNumericLine(line: string | number | undefined): number | undefined {
  if (line === undefined || line === '') return undefined;
  if (typeof line === 'number' && Number.isFinite(line)) return line;
  const n = Number(String(line).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Tokens implied by designation + EV side (two-way markets). */
function opportunityOutcomeTokens(signal: OddsDropSignal, side: 'over' | 'under'): Set<string> {
  const s = new Set<string>();
  const d = (signal.designation ?? '').toLowerCase();
  if (d.includes('over')) s.add('over');
  if (d.includes('under')) s.add('under');
  if (d.includes('home') || d === '1' || d.includes(' h ')) s.add('home');
  if (d.includes('away') || d === '2' || d.includes(' a ')) s.add('away');
  if (d.includes('draw') || d.includes('tie')) s.add('draw');
  s.add(side);
  return s;
}

function ruleMatches(rule: IndividualFilterRule, opp: BettingOpportunity): boolean {
  const signal = opp.signal;
  const sportKey = signal.sport ?? opp.pinnacle.sport ?? '';
  const leagueKey = signal.league ?? opp.pinnacle.league;
  if (rule.sport) {
    if (!sportPassesAllowlist(sportKey, new Set([rule.sport]), leagueKey)) {
      return false;
    }
  }

  const scen = scenarioFromSignal(signal);
  if (rule.markets.length > 0 && !(rule.markets as string[]).includes(scen)) {
    return false;
  }

  const tokens = opportunityOutcomeTokens(signal, opp.side);
  if (rule.outcomes.length > 0) {
    const wanted = new Set(rule.outcomes);
    let hit = false;
    for (const t of tokens) {
      if (wanted.has(t as IndividualFilterRule['outcomes'][number])) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }

  const lineVal = parseNumericLine(signal.line);
  if (rule.minLine !== undefined || rule.maxLine !== undefined) {
    if (lineVal === undefined) return false;
    if (rule.minLine !== undefined && lineVal < rule.minLine) return false;
    if (rule.maxLine !== undefined && lineVal > rule.maxLine) return false;
  }

  if (rule.periodNames.length > 0) {
    const pn = (signal.periodName ?? '').toLowerCase();
    const ok = rule.periodNames.some((frag) => pn.includes(frag));
    if (!ok) return false;
  }

  return true;
}

/**
 * When the mode list is **non-empty**, the opportunity must match **at least one** rule (OR).
 * When empty, no extra restriction beyond global + account filters.
 */
export function passIndividualStrategyGate(opp: BettingOpportunity): { ok: boolean; reason?: string } {
  const mode = resolveIndividualFilterMode(opp);
  const { inplay, prematch } = getIndividualFilters();
  const rules = mode === 'inplay' ? inplay : prematch;
  if (rules.length === 0) {
    return { ok: true };
  }
  for (const r of rules) {
    if (ruleMatches(r, opp)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'individual_strategy_no_match' };
}
