import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchJson, fmtTs } from '../api';

interface DailyTracker {
  dateLabel: string;
  executionCycles: number;
  accountAttempts: number;
  placedSuccess: number;
  placedFailed: number;
  placedSkipped: number;
}

interface TodaySummary {
  accountAttempts: number;
  placedSuccess: number;
  placedFailed: number;
  placedSkipped: number;
  totalStakedSuccess: number;
  executionCycles: number;
}

interface TodayAccountReasonEntry {
  reason: string;
  count: number;
}

interface TodayAccountReasons {
  failed: TodayAccountReasonEntry[];
  skipped: TodayAccountReasonEntry[];
}

interface ActivityRow {
  kind?: 'execution' | 'pipeline' | 'activity';
  ts: number;
  outcome: string;
  skipReason?: string;
  headline: string;
  detail: string;
  evPercent: number | null;
  sport: string | null;
  isLive: boolean | null;
  source?: string;
  level?: string;
}

interface EngineSnap {
  paused: boolean;
  executionEnabledFromEnv: boolean;
  effectiveProcessing: boolean;
  allowDuplicateBets?: boolean;
}

interface AccountCard {
  id: string;
  username: string;
  enabled: boolean;
  startingBalance?: number;
  liveBalance?: number | null;
  liveBalanceAtMs?: number;
  liveBalanceSource?: string;
  liveBalanceError?: string;
  profitVsStartingPct?: number | null;
  proxyActive: boolean;
  proxyMasked: string | null;
  betsPlacedToday: number;
  betsFailedToday: number;
  betsSkippedToday?: number;
}

interface Bootstrap {
  note?: string;
  uptimeSec: number;
  dailyTracker: DailyTracker;
  accounts?: AccountCard[];
  primaryAccountId?: string | null;
  totalStartingBankroll?: number;
  totalLiveBankroll?: number | null;
  liveBankrollAccountCount?: number;
  aggregateProfitVsStartingPct?: number | null;
  todaySummary?: TodaySummary;
  todayAccountReasons?: TodayAccountReasons;
  recentActivity?: ActivityRow[];
  engine?: EngineSnap;
}

interface FeedRow {
  kind: string;
  ts: number;
  sport?: string;
  league?: string;
  game?: string;
  market?: string;
  period?: string;
  nvp: unknown;
  dropPct: unknown;
  softOdds: unknown;
  evPct: unknown;
  evSign?: string;
  bet?: string;
  detail?: string;
  isLive?: boolean;
  minEvPercent?: number;
  skipCode?: string;
}

function fmtNgn(n: number) {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `₦${n.toFixed(2)}`;
  }
}

function evCls(sign: string | undefined) {
  if (sign === 'plus') return 'text-emerald-400';
  if (sign === 'minus') return 'text-red-400';
  return '';
}

function kindLabel(kind: string | undefined) {
  if (kind === 'pipeline_skip') return 'Skip';
  if (kind === 'opportunity') return 'Value';
  if (kind === 'execution') return 'Bet';
  if (kind === 'signal') return 'Drop';
  return kind ?? '—';
}

function liveBadge(live: boolean | undefined) {
  if (live === true) return <span className="rounded bg-sky-900/80 px-1 text-[10px] text-sky-200">Live</span>;
  if (live === false) return <span className="text-[10px] text-sb-muted">Pre</span>;
  return '—';
}

function betCls(s: string | undefined) {
  if (s === 'success') return 'text-emerald-400';
  if (s === 'failed') return 'text-red-400';
  if (s === 'partial' || s === 'skipped') return 'text-amber-400';
  return '';
}

export function DashboardHome() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [feed, setFeed] = useState<FeedRow[]>([]);

  useEffect(() => {
    let c = false;
    const load = async () => {
      try {
        const b = await fetchJson<Bootstrap>('/api/dashboard/bootstrap');
        if (!c) setBoot(b);
      } catch {
        if (!c) setBoot(null);
      }
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      c = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let c = false;
    const load = async () => {
      try {
        const { feed: f } = await fetchJson<{ feed: FeedRow[] }>('/api/dashboard/feed');
        if (!c) setFeed(f);
      } catch {
        if (!c) setFeed([]);
      }
    };
    load();
    const id = setInterval(load, 3000);
    return () => {
      c = true;
      clearInterval(id);
    };
  }, []);

  const d = boot?.dailyTracker;
  const ts = boot?.todaySummary;
  const eng = boot?.engine;
  const paused = eng?.paused === true;
  const running = eng && !paused && eng.executionEnabledFromEnv && eng.effectiveProcessing;
  const primary = boot?.accounts?.find((a) => a.id === boot.primaryAccountId);

  const placementDenom = (ts?.placedSuccess ?? 0) + (ts?.placedFailed ?? 0);
  const placementRate =
    placementDenom > 0 ? Math.round(((ts?.placedSuccess ?? 0) / placementDenom) * 1000) / 10 : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Live overview</h1>
          {boot?.note ? <p className="mt-1 text-sm text-sb-muted">{boot.note}</p> : null}
        </div>
        {eng ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sb-line bg-sb-panel px-3 py-2 text-sm">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                running ? 'bg-emerald-400' : paused ? 'bg-amber-400' : 'bg-slate-500'
              }`}
            />
            <span className="text-slate-200">
              {paused ? 'Paused' : running ? 'Running' : 'Idle / gated'}
            </span>
            {primary ? (
              <span className="text-xs text-sb-muted">
                Primary account: <strong className="text-slate-300">{primary.username}</strong>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-sb-line bg-sb-panel p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sb-muted">
            Starting bankroll (accounts)
          </div>
          <div className="mt-1 text-2xl font-bold">{fmtNgn(boot?.totalStartingBankroll ?? 0)}</div>
          <div className="mt-1 text-xs text-sb-muted">Sum of enabled accounts (see Accounts page)</div>
        </div>
        <div className="rounded-xl border border-sb-line bg-sb-panel p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sb-muted">
            Live bankroll (book)
          </div>
          <div className="mt-1 text-2xl font-bold">
            {boot?.totalLiveBankroll != null && (boot.liveBankrollAccountCount ?? 0) > 0
              ? fmtNgn(boot.totalLiveBankroll)
              : '—'}
          </div>
          <div className="mt-1 text-xs text-sb-muted">
            Probed via session (HTML or SPORTYBET_BALANCE_PATH). Accounts with a reading:{' '}
            {boot?.liveBankrollAccountCount ?? 0}
          </div>
        </div>
        <div className="rounded-xl border border-sb-line bg-sb-panel p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sb-muted">
            P/L vs starting (aggregate)
          </div>
          <div
            className={`mt-1 text-2xl font-bold ${
              (boot?.aggregateProfitVsStartingPct ?? 0) > 0
                ? 'text-emerald-400'
                : (boot?.aggregateProfitVsStartingPct ?? 0) < 0
                  ? 'text-red-400'
                  : ''
            }`}
          >
            {boot?.aggregateProfitVsStartingPct != null
              ? `${boot.aggregateProfitVsStartingPct > 0 ? '+' : ''}${boot.aggregateProfitVsStartingPct}%`
              : '—'}
          </div>
          <div className="mt-1 text-xs text-sb-muted">
            Live total vs sum of starting bankrolls only for accounts where a live balance was read
          </div>
        </div>
        <div className="rounded-xl border border-sb-line bg-sb-panel p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sb-muted">
            Staked today (success)
          </div>
          <div className="mt-1 text-2xl font-bold">{fmtNgn(ts?.totalStakedSuccess ?? 0)}</div>
          <div className="mt-1 text-xs text-sb-muted">UTC day · cash at risk placed OK</div>
        </div>
        <div className="rounded-xl border border-sb-line bg-sb-panel p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sb-muted">
            Today · attempts
          </div>
          <div className="mt-1 text-2xl font-bold">{ts?.accountAttempts ?? d?.accountAttempts ?? '—'}</div>
          <div className="mt-1 text-xs text-sb-muted">
            Each count is one account attempt in the ledger today (UTC). This is not a “sleep loop” — the
            engine reacts to incoming drops and queued runs as fast as your limits allow.
          </div>
        </div>
        <div className="rounded-xl border border-sb-line bg-sb-panel p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sb-muted">
            Placed / failed / skipped
          </div>
          <div className="mt-1 text-2xl font-bold">
            {ts
              ? `${ts.placedSuccess} / ${ts.placedFailed} / ${ts.placedSkipped}`
              : d
                ? `${d.placedSuccess} / ${d.placedFailed} / ${d.placedSkipped}`
                : '—'}
          </div>
          <div className="mt-1 text-xs text-sb-muted">Account-level rows (UTC) — see reasons below</div>
          {(boot?.todayAccountReasons?.failed?.length ?? 0) > 0 ||
          (boot?.todayAccountReasons?.skipped?.length ?? 0) > 0 ? (
            <div className="mt-3 space-y-2 border-t border-sb-line pt-3 text-left text-xs">
              {(boot?.todayAccountReasons?.failed?.length ?? 0) > 0 ? (
                <div>
                  <div className="font-semibold text-rose-300/90">Failed (why)</div>
                  <ul className="mt-1 list-inside list-disc text-sb-muted">
                    {(boot?.todayAccountReasons?.failed ?? []).map((x) => (
                      <li key={`f-${x.reason}`}>
                        <span className="font-mono text-slate-300">{x.reason}</span> · {x.count}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(boot?.todayAccountReasons?.skipped?.length ?? 0) > 0 ? (
                <div>
                  <div className="font-semibold text-amber-300/90">Skipped (why)</div>
                  <ul className="mt-1 list-inside list-disc text-sb-muted">
                    {(boot?.todayAccountReasons?.skipped ?? []).map((x) => (
                      <li key={`s-${x.reason}`}>
                        <span className="font-mono text-slate-300">{x.reason}</span> · {x.count}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-xs text-sb-muted">
              No per-account failure/skip reasons in today&apos;s ledger yet (or all successes). Open{' '}
              <Link to="/logs" className="text-violet-400 hover:underline">
                Logs
              </Link>{' '}
              for full detail.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-sb-line bg-sb-panel p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sb-muted">
            Placement success rate
          </div>
          <div className="mt-1 text-2xl font-bold">
            {placementRate != null ? `${placementRate}%` : '—'}
          </div>
          <div className="mt-1 text-xs text-sb-muted">
            placed ÷ (placed + failed) — not the same as bet win rate (needs settlement)
          </div>
        </div>
        <div className="rounded-xl border border-sb-line bg-sb-panel p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sb-muted">Bot uptime</div>
          <div className="mt-1 text-2xl font-bold">
            {boot
              ? `${Math.floor(boot.uptimeSec / 3600)}h ${Math.floor((boot.uptimeSec % 3600) / 60)}m`
              : '—'}
          </div>
          <div className="mt-1 text-xs text-sb-muted">Process lifetime on this server</div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-sb-muted">Recent activity</h2>
          <Link to="/logs" className="text-sm text-violet-400 hover:underline">
            View all in Logs →
          </Link>
        </div>
        <div className="divide-y divide-sb-line rounded-xl border border-sb-line bg-[#1a222e]">
          {(boot?.recentActivity ?? []).length === 0 ? (
            <div className="p-4 text-sm text-sb-muted">No execution rows yet today.</div>
          ) : (
            (boot?.recentActivity ?? []).map((e, i) => (
              <div key={`${e.ts}-${i}`} className="flex gap-3 p-3 text-sm">
                <div className="w-20 shrink-0 whitespace-nowrap text-xs text-sb-muted">
                  {fmtTs(e.ts)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {e.kind ? (
                      <span className="rounded border border-sb-line px-1.5 py-0.5 text-[10px] uppercase text-sb-muted">
                        {e.kind}
                      </span>
                    ) : null}
                    {e.source ? (
                      <span className="rounded border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {e.source}
                      </span>
                    ) : null}
                    <span className="font-medium text-slate-200">{e.headline}</span>
                    {e.isLive === true ? (
                      <span className="rounded bg-sky-900/80 px-1 text-[10px] text-sky-200">Live</span>
                    ) : null}
                    {e.evPercent != null && Number.isFinite(e.evPercent) ? (
                      <span
                        className={
                          e.evPercent > 0
                            ? 'text-xs text-emerald-400'
                            : e.evPercent < 0
                              ? 'text-xs text-red-400'
                              : 'text-xs text-sb-muted'
                        }
                      >
                        EV {e.evPercent.toFixed(2)}%
                      </span>
                    ) : null}
                  </div>
                  {e.detail ? <div className="mt-0.5 text-xs text-sb-muted">{e.detail}</div> : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-sb-muted">Live feed</h2>
        <p className="mb-2 max-w-3xl text-xs text-sb-muted">
          <strong>Skip</strong> rows show EV/NVP vs engine thresholds (e.g. negative EV or below min EV).{' '}
          <strong>Value</strong> passed filters and triggered alerts. <strong>Bet</strong> is Playwright execution.
        </p>
        <div className="max-h-[52vh] overflow-auto rounded-xl border border-sb-line">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-sb-panel">
              <tr className="border-b border-sb-line text-sb-muted">
                <th className="p-2">Kind</th>
                <th className="p-2">Live</th>
                <th className="p-2">Time</th>
                <th className="p-2">Sport / League</th>
                <th className="p-2">Game</th>
                <th className="p-2">Market / Period</th>
                <th className="p-2">NVP</th>
                <th className="p-2">Drop %</th>
                <th className="p-2">Soft odds</th>
                <th className="p-2">EV %</th>
                <th className="p-2">Min EV</th>
                <th className="p-2">±EV</th>
                <th className="p-2">Bet</th>
                <th className="p-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {feed.map((r, i) => {
                const ev =
                  typeof r.evPct === 'number' ? r.evPct.toFixed(2) : String(r.evPct ?? '—');
                const drop =
                  typeof r.dropPct === 'number' ? r.dropPct.toFixed(2) : String(r.dropPct ?? '—');
                const nvp =
                  typeof r.nvp === 'number' ? r.nvp.toFixed(3) : String(r.nvp ?? '—');
                const odds =
                  typeof r.softOdds === 'number'
                    ? r.softOdds.toFixed(2)
                    : String(r.softOdds ?? '—');
                const evTag = r.evSign === 'plus' ? '+' : r.evSign === 'minus' ? '−' : '·';
                const minEv =
                  typeof r.minEvPercent === 'number' ? r.minEvPercent.toFixed(1) : '—';
                return (
                  <tr key={i} className="border-b border-sb-line/80 align-top">
                    <td className="whitespace-nowrap p-2 text-sb-muted">{kindLabel(r.kind)}</td>
                    <td className="p-2">{liveBadge(r.isLive)}</td>
                    <td className="whitespace-nowrap p-2">{fmtTs(r.ts)}</td>
                    <td className="p-2">
                      {r.sport}
                      <br />
                      <span className="text-sb-muted">{r.league}</span>
                    </td>
                    <td className="p-2">{r.game}</td>
                    <td className="p-2">
                      {r.market}
                      <br />
                      <span className="text-sb-muted">{r.period}</span>
                    </td>
                    <td className="p-2">{nvp}</td>
                    <td className="p-2">{drop}</td>
                    <td className="p-2">{odds}</td>
                    <td className={`p-2 ${evCls(r.evSign)}`}>{ev}</td>
                    <td className="p-2 text-sb-muted">{minEv}</td>
                    <td className={`p-2 ${evCls(r.evSign)}`}>{evTag}</td>
                    <td className={`p-2 ${betCls(r.bet)}`}>{r.bet}</td>
                    <td className="max-w-[220px] p-2 text-sb-muted">{r.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-sb-muted">Active accounts</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(boot?.accounts ?? []).map((a) => {
            const isPrimary = a.id === boot?.primaryAccountId;
            return (
              <div
                key={a.id}
                className={`rounded-xl border p-4 text-sm ${
                  isPrimary ? 'border-violet-600/60 bg-violet-950/20' : 'border-sb-line bg-[#1a222e]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">{a.username || a.id}</div>
                  {isPrimary ? (
                    <span className="rounded bg-violet-600/30 px-2 py-0.5 text-[10px] text-violet-200">
                      Primary
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex justify-between text-sb-muted">
                  <span>Enabled</span>
                  <span className="text-slate-200">
                    <span
                      className={`mr-1 inline-block h-2 w-2 rounded-full ${a.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`}
                    />
                    {a.enabled ? 'yes' : 'no'}
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-sb-muted">
                  <span>Live balance</span>
                  <span className="text-right text-slate-200">
                    {a.liveBalance != null && Number.isFinite(a.liveBalance)
                      ? fmtNgn(a.liveBalance)
                      : a.liveBalanceError
                        ? `— (${a.liveBalanceError})`
                        : '—'}
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-sb-muted">
                  <span>P/L vs start</span>
                  <span
                    className={
                      (a.profitVsStartingPct ?? 0) > 0
                        ? 'text-emerald-400'
                        : (a.profitVsStartingPct ?? 0) < 0
                          ? 'text-red-400'
                          : 'text-slate-200'
                    }
                  >
                    {a.profitVsStartingPct != null
                      ? `${a.profitVsStartingPct > 0 ? '+' : ''}${a.profitVsStartingPct}%`
                      : '—'}
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-sb-muted">
                  <span>Starting bankroll</span>
                  <span className="text-slate-200">{fmtNgn(a.startingBalance ?? 0)}</span>
                </div>
                <div className="mt-1 flex justify-between text-sb-muted">
                  <span>Proxy</span>
                  <span className="text-slate-200">
                    {a.proxyActive ? `on · ${a.proxyMasked ?? ''}` : 'off'}
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-sb-muted">
                  <span>Placed / failed / skip</span>
                  <span className="text-slate-200">
                    {a.betsPlacedToday} / {a.betsFailedToday} / {a.betsSkippedToday ?? 0}
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-sb-muted">
                  <span>Units P/L</span>
                  <span className="text-slate-200">—</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
