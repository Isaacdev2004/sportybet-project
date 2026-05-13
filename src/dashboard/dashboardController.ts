import type { Request, Response } from 'express';

import { env } from '../config/env.js';
import { filters } from '../config/filters.js';
import { signalDropPercent } from '../core/decisionEngine.js';
import { getExecutionLogs } from '../state/executionLogStore.js';
import { readLedgerNewest, readLedgerTailForDashboard } from '../state/betLedgerStore.js';
import type { RecentStore } from '../state/recentStore.js';
import type { PinnacleSseClient } from '../core/sseClient.js';
import { getIngestSnapshot } from '../core/ingestStatus.js';
import type { OddsDropSignal } from '../types/index.js';
import type { BetExecutionResult } from '../execution/types.js';
import {
  aggregateExecutionRows,
  dailyAccountTotals,
  dailyTrackerFromRows,
  rangeToMs,
  type StatsRangeKey,
  utcDayBounds,
} from './ledgerStats.js';
import { getAccounts } from '../account/accountManager.js';
import { getEngineControlState, setEnginePaused } from '../state/engineRuntime.js';
import { getSportyBetApiHealthCached } from '../services/sportybet/api/sportybetApiHealth.js';

export interface DashboardControllerDeps {
  sse: PinnacleSseClient;
  store: RecentStore;
  startedAtMs: number;
}

function parseStatsRange(raw: unknown): StatsRangeKey {
  const s = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (s === 'today' || s === '7d' || s === '30d' || s === 'all') return s;
  return 'today';
}

/** Merge in-memory execution ring with tail of ledger (dedupe by finishedAtMs + opportunityId). */
function mergedExecutionRows(max = 200): BetExecutionResult[] {
  const mem = getExecutionLogs();
  const disk = readLedgerNewest(Math.min(300, max + mem.length));
  const key = (r: BetExecutionResult) => `${r.opportunityId}:${r.finishedAtMs}`;
  const seen = new Set<string>();
  const out: BetExecutionResult[] = [];
  for (const r of mem) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  for (const r of disk) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  out.sort((a, b) => b.finishedAtMs - a.finishedAtMs);
  return out.slice(0, max);
}

export function getDashboardBootstrap(deps: DashboardControllerDeps) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const poll = getIngestSnapshot();
      const sseOk = env.pinnacle.useDropsPoll ? false : deps.sse.connected;
      const snap = deps.store.dashboardSnapshot();
      const ledgerRows = readLedgerTailForDashboard(25_000);
      const daily = dailyTrackerFromRows(ledgerRows);
      const { label: utcDay } = utcDayBounds();
      const accounts = getAccounts().map((a) => {
        const d = dailyAccountTotals(ledgerRows, a.id);
        return {
          id: a.id,
          username: a.username,
          enabled: a.enabled !== false,
          proxyActive: Boolean(a.proxy?.trim()),
          proxyMasked: a.proxy
            ? a.proxy.includes('@')
              ? '***@' + a.proxy.split('@').pop()
              : a.proxy.slice(0, 12) + (a.proxy.length > 12 ? '…' : '')
            : null,
          stakeRanges: a.stakeRanges,
          betsPlacedToday: d.placed,
          betsFailedToday: d.failed,
          betsSkippedToday: d.skipped,
          dailyUnitsPnl: d.unitsPnl,
        };
      });

      const sportyBetApiHealth = await getSportyBetApiHealthCached();

      res.json({
        brand: 'SportyBet',
        bookLabel: 'SportyBet',
        uptimeSec: Math.floor((Date.now() - deps.startedAtMs) / 1000),
        sseConnected: sseOk,
        ingest: poll,
        pinnacle: {
          ingestMode: env.pinnacle.useDropsPoll ? 'drops_poll' : 'sse',
          ssePath: env.pinnacle.ssePath,
          apiBase: env.pinnacle.apiBase,
          dropsPollMs: env.pinnacle.dropsPollMs,
        },
        utcDay,
        dailyTracker: daily,
        accounts,
        engine: getEngineControlState(),
        sportyBetApiHealth,
        note:
          'Daily tracker uses UTC midnight. Settlement (won/lost/units P/L) is not wired yet — columns show placeholders where applicable.',
        snapshot: snap,
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
}

export function getDashboardFeed(deps: DashboardControllerDeps) {
  return (_req: Request, res: Response): void => {
    const snap = deps.store.dashboardSnapshot();
    const execs = mergedExecutionRows(180);
    const feed: Record<string, unknown>[] = [];

    for (const sk of snap.pipelineSkips ?? []) {
      const ev = sk.evPercent;
      feed.push({
        kind: 'pipeline_skip',
        ts: sk.ts,
        sport: sk.sport,
        league: sk.league,
        game: sk.game,
        market: sk.market,
        period: sk.period ?? '—',
        nvp: sk.nvp ?? '—',
        dropPct: sk.dropPct ?? '—',
        softOdds: sk.softOdds ?? '—',
        evPct: ev ?? '—',
        evSign: typeof ev === 'number' ? (ev > 0 ? 'plus' : ev < 0 ? 'minus' : 'neutral') : 'neutral',
        bet: 'skipped',
        detail: sk.reasonLabel,
        skipCode: sk.reason,
        minEvPercent: sk.minEvPercent,
        isLive: sk.isLive,
      });
    }

    for (const s of snap.signals) {
      feed.push({
        kind: 'signal',
        ts: s.receivedAtMs,
        sport: s.sport,
        league: s.league,
        game: `${s.home ?? '?'} vs ${s.away ?? '?'}`,
        market: s.market,
        period: s.periodName ?? (s.period != null ? String(s.period) : '—'),
        nvp: '—',
        dropPct: signalDropPercent(s as OddsDropSignal),
        softOdds: '—',
        evPct: '—',
        evSign: 'neutral',
        bet: '—',
        detail: 'Raw drop ingested',
        isLive: s.isLive,
      });
    }

    for (const o of snap.opportunities) {
      const ev = o.evPercent;
      feed.push({
        kind: 'opportunity',
        ts: o.receivedAtMs,
        sport: o.sport,
        league: o.league,
        game: o.game,
        market: o.market,
        period: o.periodName ?? (o.period != null ? String(o.period) : '—'),
        nvp: o.nvpUsed,
        dropPct: signalDropPercent({
          receivedAtMs: o.receivedAtMs,
          prevOdds: o.prevOdds,
          currentOdds: o.currentOdds,
        } as OddsDropSignal),
        softOdds: o.softOdds,
        evPct: ev,
        evSign: ev > 0 ? 'plus' : ev < 0 ? 'minus' : 'neutral',
        bet: '—',
        detail: 'Value pass — queued for execution / alerts',
        isLive: o.isLive,
      });
    }

    for (const r of execs) {
      const o = r.opportunity;
      const betSummary = summarizeExecutionBet(r);
      feed.push({
        kind: 'execution',
        ts: r.finishedAtMs,
        sport: o?.sport,
        league: o?.league,
        game: o ? `${o.home ?? '?'} vs ${o.away ?? '?'}` : '—',
        market: o?.market,
        period: o?.periodName ?? (o?.period != null ? String(o.period) : '—'),
        nvp: o?.nvpDecimal ?? '—',
        dropPct: o?.dropPercent ?? '—',
        softOdds: o?.softOdds ?? '—',
        evPct: o?.evPercent ?? '—',
        evSign:
          o && o.evPercent > 0 ? 'plus' : o && o.evPercent < 0 ? 'minus' : 'neutral',
        bet: betSummary.status,
        detail: betSummary.detail,
        outcome: r.outcome,
        isLive: o?.isLive,
      });
    }

    feed.sort((a, b) => (b.ts as number) - (a.ts as number));
    res.json({ feed: feed.slice(0, 250) });
  };
}

function summarizeExecutionBet(r: BetExecutionResult): { status: string; detail: string } {
  if (r.outcome === 'execution_off')
    return { status: 'skipped', detail: r.skipReason ?? 'execution off' };
  if (r.outcome === 'filtered_out')
    return { status: 'skipped', detail: r.skipReason ?? 'filtered' };
  if (r.outcome === 'dedup_skipped')
    return { status: 'skipped', detail: r.skipReason ?? 'dedup' };
  if (r.outcome === 'no_enabled_accounts')
    return { status: 'skipped', detail: r.skipReason ?? 'no accounts' };

  const rows = r.accountResults;
  if (rows.length === 0) return { status: 'skipped', detail: r.skipReason ?? 'no rows' };

  const ok = rows.filter((x) => x.status === 'success').length;
  const fail = rows.filter((x) => x.status === 'failed').length;
  const skip = rows.filter((x) => x.status === 'skipped').length;

  if (ok > 0 && fail === 0 && skip === 0)
    return { status: 'success', detail: `${ok} account(s) placed` };
  if (ok > 0)
    return {
      status: 'partial',
      detail: `placed ${ok}, failed ${fail}, skipped ${skip}`,
    };
  if (fail > 0 && skip === 0) return { status: 'failed', detail: `${fail} failed` };
  if (skip > 0 && fail === 0)
    return {
      status: 'skipped',
      detail: rows.map((x) => x.reason).filter(Boolean).join('; ') || 'skipped',
    };
  return { status: 'failed', detail: `failed ${fail}, skipped ${skip}` };
}

function normQ(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/** Flatten ledger to bet rows with opportunity fields for filtered stats. */
function flattenBetRows(rows: BetExecutionResult[]): Array<{
  finishedAtMs: number;
  account: string;
  sport?: string;
  market?: string;
  period?: string;
  placement: string;
  stake: number;
  evPct?: number;
  odds?: number;
}> {
  const out: ReturnType<typeof flattenBetRows> = [];
  for (const r of rows) {
    const o = r.opportunity;
    const period =
      o?.periodName ?? (o?.period != null ? String(o.period) : undefined);
    for (const ar of r.accountResults) {
      out.push({
        finishedAtMs: ar.finishedAtMs ?? r.finishedAtMs,
        account: ar.accountId,
        sport: o?.sport,
        market: o?.market,
        period,
        placement: ar.status,
        stake: ar.stake,
        evPct: o?.evPercent,
        odds: o?.softOdds,
      });
    }
  }
  return out;
}

export function getDashboardStats() {
  return (req: Request, res: Response): void => {
    const range = parseStatsRange(req.query.range);
    const sportQ = normQ(req.query.sport);
    const marketQ = normQ(req.query.market);
    const periodQ = normQ(req.query.period);
    const nowMs = Date.now();
    let rows = readLedgerTailForDashboard(25_000);
    const { fromMs, toMs } = rangeToMs(range, nowMs);
    rows = rows.filter((r) => r.finishedAtMs >= fromMs && r.finishedAtMs < toMs);

    if (sportQ && sportQ !== 'all') {
      rows = rows.filter((r) => (r.opportunity?.sport ?? '').toLowerCase().includes(sportQ));
    }
    if (marketQ && marketQ !== 'all') {
      rows = rows.filter((r) => (r.opportunity?.market ?? '').toLowerCase().includes(marketQ));
    }
    if (periodQ && periodQ !== 'all') {
      rows = rows.filter((r) => {
        const p = r.opportunity?.periodName ?? String(r.opportunity?.period ?? '');
        return p.toLowerCase().includes(periodQ);
      });
    }

    const agg = aggregateExecutionRows(rows, range);
    const winDen = agg.won + agg.lost;
    const winRate = winDen > 0 ? (agg.won / winDen) * 100 : null;
    const flat = flattenBetRows(rows);
    const totalBets = agg.accountAttempts;
    res.json({
      range,
      filters: { sport: sportQ || 'all', market: marketQ || 'all', period: periodQ || 'all' },
      aggregate: agg,
      /** Spec naming: Total Bets ≈ account-level attempts in window */
      totalBets,
      winRate,
      roi: null as number | null,
      profitLossUnits: null as number | null,
      sampleRows: flat.slice(0, 500),
      settlementNote:
        'Won / Lost / ROI / Profit use settlement data — not implemented. Pending ≈ successful placements awaiting settlement.',
    });
  };
}

export function getDashboardBets() {
  return (req: Request, res: Response): void => {
    const raw = req.query.limit;
    const n = typeof raw === 'string' ? Number(raw) : NaN;
    const limit = Number.isFinite(n) ? Math.min(2000, Math.max(1, Math.floor(n))) : 500;
    const rows = readLedgerTailForDashboard(25_000);
    const flat: Record<string, unknown>[] = [];
    for (const r of rows) {
      const o = r.opportunity;
      for (const ar of r.accountResults) {
        flat.push({
          finishedAtMs: ar.finishedAtMs ?? r.finishedAtMs,
          account: ar.accountId,
          sport: o?.sport,
          league: o?.league,
          game: o ? `${o.home ?? '?'} vs ${o.away ?? '?'}` : '—',
          market: o?.market,
          period: o?.periodName ?? (o?.period != null ? String(o.period) : '—'),
          selection: formatSelection(o),
          odds: o?.softOdds,
          nvp: o?.nvpDecimal,
          evPct: o?.evPercent,
          dropPct: o?.dropPercent,
          stake: ar.stake,
          placement: ar.status,
          reason: ar.reason,
          result: settlementLabel(ar.status),
          plUnits: null,
        });
      }
    }
    flat.sort((a, b) => (b.finishedAtMs as number) - (a.finishedAtMs as number));
    res.json({ rows: flat.slice(0, limit) });
  };
}

function settlementLabel(status: string): string {
  if (status === 'success') return 'Pending';
  if (status === 'failed') return 'Failed';
  if (status === 'skipped') return 'Skipped';
  return status;
}

function formatSelection(o: BetExecutionResult['opportunity']): string {
  if (!o) return '—';
  const line = o.line != null ? String(o.line) : '';
  const des = o.designation ?? o.side;
  return [des, line].filter(Boolean).join(' ').trim() || '—';
}

export function getDashboardFiltersView() {
  return (_req: Request, res: Response): void => {
    res.json({
      engineFilters: {
        minEvPercent: filters.minEvPercent,
        minDropPercent: filters.minDropPercent,
        maxSignalAgeMs: filters.maxSignalAgeMs,
        maxPlayableWindowMinutes: filters.maxPlayableWindowMinutes,
        requireExplicitLive: filters.requireExplicitLive,
        excludedLeagues: [...filters.excludedLeagues],
        allowedSports: [...filters.allowedSports],
      },
      note: 'Filters are driven by environment variables. Restart the process after changing .env.',
    });
  };
}

export function getDashboardProxiesView() {
  return (_req: Request, res: Response): void => {
    res.json({
      iproyalConfigured: Boolean(process.env.IPROYAL_API_KEY?.trim()),
      note:
        'Assign proxies via data/accounts.json (proxy field per account). iProyal auto-buy is not implemented in this build.',
    });
  };
}

export function getDashboardControl() {
  return (_req: Request, res: Response): void => {
    res.json(getEngineControlState());
  };
}

export function postDashboardControl() {
  return (req: Request, res: Response): void => {
    const paused = (req.body as { paused?: unknown })?.paused;
    if (typeof paused !== 'boolean') {
      res.status(400).json({ error: 'JSON body must include boolean "paused"' });
      return;
    }
    setEnginePaused(paused);
    res.json(getEngineControlState());
  };
}

export function getDashboardStream(deps: DashboardControllerDeps) {
  return (req: Request, res: Response): void => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('hello', {
      uptimeSec: Math.floor((Date.now() - deps.startedAtMs) / 1000),
      ts: Date.now(),
    });

    const iv = setInterval(() => {
      const poll = getIngestSnapshot();
      const sseOk = env.pinnacle.useDropsPoll ? false : deps.sse.connected;
      send('tick', {
        sseConnected: sseOk,
        ingest: poll,
        ts: Date.now(),
      });
    }, 4000);

    req.on('close', () => {
      clearInterval(iv);
    });
  };
}
