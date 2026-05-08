import type { BettingOpportunity, OddsDropSignal } from '../types/index.js';

const MAX_SIGNALS = 200;
const MAX_OPPS = 100;

/**
 * In-memory ring buffers for the optional HTTP dashboard (single process).
 */
export class RecentStore {
  private signals: OddsDropSignal[] = [];
  private opps: BettingOpportunity[] = [];

  recordSignal(s: OddsDropSignal): void {
    this.signals.unshift(s);
    if (this.signals.length > MAX_SIGNALS) this.signals.pop();
  }

  recordOpportunity(o: BettingOpportunity): void {
    this.opps.unshift(o);
    if (this.opps.length > MAX_OPPS) this.opps.pop();
  }

  snapshot() {
    return {
      signals: this.signals.slice(0, 50).map(sanitizeSignal),
      opportunities: this.opps.slice(0, 30).map(sanitizeOpp),
    };
  }
}

function sanitizeSignal(s: OddsDropSignal) {
  return {
    receivedAtMs: s.receivedAtMs,
    sport: s.sport,
    league: s.league,
    home: s.home,
    away: s.away,
    market: s.market,
    line: s.line,
    designation: s.designation,
    prevOdds: s.prevOdds,
    currentOdds: s.currentOdds,
    parentId: s.parentId,
    period: s.period,
    periodName: s.periodName,
    eventStartUnixSec: s.eventStartUnixSec,
    sector: s.sector,
    isLive: s.isLive,
  };
}

function sanitizeOpp(o: BettingOpportunity) {
  return {
    receivedAtMs: o.signal.receivedAtMs,
    league: o.pinnacle.league ?? o.signal.league,
    game: `${o.pinnacle.home ?? '?'} vs ${o.pinnacle.away ?? '?'}`,
    market: o.pinnacle.market,
    softBookLabel: o.softBookLabel,
    evPercent: o.evPercent,
    nvpUsed: o.nvpUsed,
    softOdds: o.softOdds,
    side: o.side,
    formattedMovement: o.formattedMovement,
  };
}
