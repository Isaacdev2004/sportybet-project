/**
 * Phase 1 alert body — stakeholder layout (live drop + NVP + book + scores when available).
 */
import type { BettingOpportunity } from '../types/index.js';
import type { OddsDropSignal } from '../types/index.js';
import { signalDropPercent } from '../core/decisionEngine.js';
import { STUB_MATCH_CONTEXT_PROVIDER_NVP } from './sportybetService.js';

function fmtNum(n: number | undefined, digits = 2): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/** Maps sport + numeric period (+ optional `period_name` from feed) into a human label. */
export function describeGameSegmentLabel(
  period: number | undefined,
  sport?: string,
  periodName?: string,
): string {
  const name = (periodName ?? '').trim();
  if (name) return name;

  if (period === undefined) return '—';
  const sp = (sport ?? '').trim().toLowerCase();
  if (sp.includes('basketball')) {
    const b: Record<number, string> = {
      0: 'Full game',
      1: '1st Half',
      2: '2nd Half',
      3: 'Q1',
      4: 'Q2',
      5: 'Q3',
      6: 'Q4',
    };
    return b[period] ?? `Period ${period}`;
  }
  /** Tennis: live game/set props use period ≥1 as set index (e.g. 3 → Set 3). */
  if (sp.includes('tennis')) {
    if (period === 0) return 'Full match';
    return `Set ${period}`;
  }
  const fb: Record<number, string> = {
    0: 'Full match',
    1: '1st Half',
    2: '2nd Half',
  };
  return fb[period] ?? `Period ${period}`;
}

/** Short label — used when `sect` absent (Total / Spread / Moneyline…) */
export function summarizeMarketBand(signal: OddsDropSignal): string {
  const m = `${signal.market ?? ''} ${signal.sector ?? ''}`.toLowerCase().trim();
  if (/\bteam_?total\b/.test(m) || m.includes('team total')) return 'Team total';
  if (m.includes('total')) return 'Total';
  if (m.includes('spread') || m.includes('handicap')) return 'Spread / handicap';
  if (m.includes('money')) return 'Moneyline';
  if (signal.sector?.trim()) return signal.sector.trim();
  if (signal.market?.trim()) return signal.market.trim();
  return 'Market';
}

function capitalizeOutcomeToken(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Line display for 🎲; PinnOdds uses `point` (merged into `signal.line`). */
export function formatLineDice(signal: OddsDropSignal): string {
  const L = signal.line;
  if (L === undefined || L === '') return '';
  if (typeof L === 'number' && Number.isFinite(L)) {
    return Number.isInteger(L) ? String(Math.trunc(L)) : String(L);
  }
  const s = String(L).trim();
  if (!s) return '';
  const n = Number(s);
  return Number.isFinite(n) && String(n) === s && Number.isInteger(n)
    ? String(Math.trunc(n))
    : s;
}

/** Outcome + line for 🎲 (e.g. Under 10, Away 1.5, Over 2.5). */
export function formatOutcomeDice(signal: OddsDropSignal): string {
  const des = (signal.designation ?? '').trim();
  const ln = formatLineDice(signal);
  const dLower = des.toLowerCase();

  if (ln && /\bover\b|\bunder\b/.test(dLower)) {
    const head = des.split(/\s+/)[0] ?? des;
    return `${capitalizeOutcomeToken(head)} ${ln}`.trim();
  }
  if (ln && (dLower.includes('home') || dLower.includes('away'))) {
    return `${capitalizeOutcomeToken(des)} ${ln}`.trim();
  }
  if (ln && (signal.sector ?? '').toLowerCase().includes('spread')) {
    return `${des ? capitalizeOutcomeToken(des) : 'Side'} ${ln}`.trim();
  }
  if (des && ln) return `${capitalizeOutcomeToken(des)} ${ln}`.trim();
  if (des) return capitalizeOutcomeToken(des);
  return signal.market?.trim() || 'Outcome';
}

/** 🔩 Row: PinnOdds `sect` as “Match Total” / “Match Spread” etc. */
export function formatBettingMarketSect(signal: OddsDropSignal): string {
  const raw = (signal.sector ?? '').trim().replace(/_/g, ' ');
  if (raw) {
    const lower = raw.toLowerCase();
    if (lower === 'total') return 'Match Total';
    if (lower === 'spread' || lower === 'handicap') return 'Match Spread';
    if (lower === 'moneyline' || lower === 'money line') return 'Moneyline';
    return raw;
  }
  const band = summarizeMarketBand(signal);
  const bLower = band.toLowerCase();
  if (bLower === 'total') return 'Match Total';
  if (bLower === 'spread / handicap') return 'Match Spread';
  return band;
}

function formatStakeLimitDisplay(limit: number | string | undefined): string {
  if (limit === undefined) return '—';
  if (typeof limit === 'number' && Number.isFinite(limit)) {
    if (limit % 1 === 0) return `$${limit}`;
    return `$${limit.toFixed(2)}`;
  }
  const s = String(limit).trim();
  return s || '—';
}

function sportIcon(sport?: string): string {
  const s = (sport ?? '').trim().toLowerCase();
  if (s.includes('soccer')) return '⚽';
  if (s.includes('baseball')) return '⚾';
  if (s.includes('basketball')) return '🏀';
  if (s.includes('tennis')) return '🎾';
  return '🏟️';
}

/** Parses `matchContext` from `/details` such as `H0–A1` */
export function parseHomeAwayFromMatchContext(
  ctx: string | undefined,
): { h?: number; a?: number } {
  if (!ctx?.trim() || ctx === STUB_MATCH_CONTEXT_PROVIDER_NVP) return {};
  const m = ctx.trim().match(/H([\d.]+).*?A([\d.]+)/i);
  if (m) {
    const h = Number(m[1]);
    const a = Number(m[2]);
    if (Number.isFinite(h) && Number.isFinite(a)) return { h, a };
  }
  const alt = ctx.match(/(\d+)\s*[–-]\s*(\d+)/);
  if (alt) {
    const h = Number(alt[1]);
    const a = Number(alt[2]);
    if (Number.isFinite(h) && Number.isFinite(a)) return { h, a };
  }
  return {};
}

export function formatPhase1TelegramAlert(o: BettingOpportunity): string {
  const { signal, pinnacle, evPercent, nvpUsed, softOdds, softBookLabel } = o;
  const lg = pinnacle.league ?? signal.league ?? '—';
  const home = pinnacle.home ?? signal.home ?? '?';
  const away = pinnacle.away ?? signal.away ?? '?';
  const sportDisp = pinnacle.sport ?? signal.sport ?? '—';

  const fromDisp = signal.prevOdds !== undefined ? fmtNum(signal.prevOdds, 2) : '—';
  const toDisp =
    signal.currentOdds !== undefined ? fmtNum(signal.currentOdds, 2) : '—';

  const nvpDisp = fmtNum(nvpUsed, 3);
  const dropPct = signalDropPercent(signal);
  const dropDisp = dropPct !== undefined ? fmtNum(dropPct, 2) : '—';

  const intervalDisp =
    signal.dropIntervalSecs !== undefined && Number.isFinite(signal.dropIntervalSecs)
      ? String(Math.round(signal.dropIntervalSecs))
      : '—';

  let hs = signal.liveHomeScore;
  let as = signal.liveAwayScore;
  if (!(typeof hs === 'number' && typeof as === 'number')) {
    const parsed = parseHomeAwayFromMatchContext(pinnacle.matchContext);
    if (parsed.h !== undefined && parsed.a !== undefined) {
      hs = parsed.h;
      as = parsed.a;
    }
  }

  let scoreDisp = '— —';
  if (typeof hs === 'number' && typeof as === 'number' && Number.isFinite(hs) && Number.isFinite(as)) {
    scoreDisp = `${hs} – ${as}`;
  }

  const periodLab = describeGameSegmentLabel(
    signal.period,
    sportDisp,
    signal.periodName,
  );
  const bettingSect = formatBettingMarketSect(signal);
  const outcomeDice = formatOutcomeDice(signal);

  const clockDisp = signal.matchClock?.trim() || '—';
  const limitDisp = formatStakeLimitDisplay(signal.stakeLimit);

  const isMockBook = /\bmock\b/i.test(softBookLabel);
  const nvpFoot =
    pinnacle.matchContext === STUB_MATCH_CONTEXT_PROVIDER_NVP
      ? '(True price / NVP from PinnOdds `nvp` field on this drop.)'
      : '(True price dewagged from fetched PinnOdds market payload.)';

  const icon = sportIcon(sportDisp);

  const lines: string[] = [
    `🔔 Live drops`,
    ``,
    `🆚 ${home} vs ${away}`,
    `🏆 ${lg}`,
    `🎲 ${outcomeDice}`,
    `🔩 ${bettingSect}`,
    ``,
    `📉 ${fromDisp} → ${toDisp} | (${nvpDisp}) | ${dropDisp}%`,
    `💰 Value ${fmtNum(evPercent, 2)}%`,
    `⏱️ Interval ${intervalDisp} secs`,
    ``,
    `🥅 ${scoreDisp}`,
    `🕹️ ${periodLab}`,
    ``,
    `${icon} ${sportDisp}`,
    `🏠 Book Quote ${fmtNum(softOdds, 3)} (${softBookLabel})`,
    `⏰ ${clockDisp}`,
    `💰 Limit ${limitDisp}`,
    ``,
    nvpFoot,
  ];

  if (isMockBook) {
    lines.push(
      '',
      '(Phase 1: SportyBet line is mocked from the sharp move until the real SportyBet feed is wired — treat Value as structural only.)',
    );
  }

  return lines.join('\n');
}
