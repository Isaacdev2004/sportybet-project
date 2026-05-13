import type { BettingOpportunity, OddsDropSignal } from '../types/index.js';

const MAX_SIGNALS = 200;
const MAX_OPPS = 100;
const MAX_PIPELINE_SKIPS = 200;

/** Engine rejected a line after soft + EV were known (or early skip with reason). */
export interface PipelineSkipEntry {
  ts: number;
  reason: string;
  reasonLabel: string;
  sport?: string;
  league?: string;
  game: string;
  market?: string;
  period?: string;
  isLive?: boolean;
  evPercent?: number;
  nvp?: number;
  dropPct?: number;
  softOdds?: number;
  minEvPercent?: number;
}

/**
 * In-memory ring buffers for the optional HTTP dashboard (single process).
 */
export class RecentStore {
  private signals: OddsDropSignal[] = [];
  private opps: BettingOpportunity[] = [];
  private pipelineSkips: PipelineSkipEntry[] = [];

  recordSignal(s: OddsDropSignal): void {
    this.signals.unshift(s);
    if (this.signals.length > MAX_SIGNALS) this.signals.pop();
  }

  recordOpportunity(o: BettingOpportunity): void {
    this.opps.unshift(o);
    if (this.opps.length > MAX_OPPS) this.opps.pop();
  }

  recordPipelineSkip(row: PipelineSkipEntry): void {
    this.pipelineSkips.unshift(row);
    if (this.pipelineSkips.length > MAX_PIPELINE_SKIPS) this.pipelineSkips.pop();
  }

  snapshot() {
    return {
      signals: this.signals.slice(0, 50).map(sanitizeSignal),
      opportunities: this.opps.slice(0, 30).map(sanitizeOpp),
    };
  }

  /** Larger buffers for the SportyBet dashboard live merge. */
  dashboardSnapshot() {
    return {
      signals: this.signals.slice(0, 120).map(sanitizeSignal),
      opportunities: this.opps.slice(0, 80).map(sanitizeOpp),
      pipelineSkips: this.pipelineSkips.slice(0, 120),
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
    sport: o.signal.sport ?? o.pinnacle.sport,
    league: o.pinnacle.league ?? o.signal.league,
    periodName: o.signal.periodName,
    period: o.signal.period,
    game: `${o.pinnacle.home ?? '?'} vs ${o.pinnacle.away ?? '?'}`,
    market: o.pinnacle.market,
    line: o.signal.line,
    designation: o.signal.designation,
    softBookLabel: o.softBookLabel,
    evPercent: o.evPercent,
    nvpUsed: o.nvpUsed,
    softOdds: o.softOdds,
    side: o.side,
    formattedMovement: o.formattedMovement,
    isLive: o.signal.isLive ?? o.pinnacle.isLive,
    prevOdds: o.signal.prevOdds,
    currentOdds: o.signal.currentOdds,
  };
}
