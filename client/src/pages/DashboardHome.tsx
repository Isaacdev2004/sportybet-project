import { useEffect, useState } from 'react';
import { fetchJson, fmtTs } from '../api';

interface DailyTracker {
  dateLabel: string;
  executionCycles: number;
  accountAttempts: number;
  placedSuccess: number;
  placedFailed: number;
  placedSkipped: number;
}

interface AccountCard {
  id: string;
  username: string;
  enabled: boolean;
  proxyActive: boolean;
  proxyMasked: string | null;
  betsPlacedToday: number;
  betsFailedToday: number;
}

interface Bootstrap {
  note?: string;
  uptimeSec: number;
  dailyTracker: DailyTracker;
  accounts?: AccountCard[];
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
}

function evCls(sign: string | undefined) {
  if (sign === 'plus') return 'text-emerald-400';
  if (sign === 'minus') return 'text-red-400';
  return '';
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

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Live overview</h1>
      {boot?.note ? <p className="text-sm text-sb-muted">{boot.note}</p> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-sb-line bg-sb-panel p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sb-muted">
            Bets attempted today (UTC)
          </div>
          <div className="mt-1 text-2xl font-bold">{d?.accountAttempts ?? '—'}</div>
          <div className="mt-1 text-xs text-sb-muted">
            Execution cycles: {d?.executionCycles ?? '—'}
          </div>
        </div>
        <div className="rounded-xl border border-sb-line bg-sb-panel p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sb-muted">
            Placed / failed / skipped
          </div>
          <div className="mt-1 text-2xl font-bold">
            {d ? `${d.placedSuccess} / ${d.placedFailed} / ${d.placedSkipped}` : '—'}
          </div>
          <div className="mt-1 text-xs text-sb-muted">Account-level rows</div>
        </div>
        <div className="rounded-xl border border-sb-line bg-sb-panel p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sb-muted">
            Bot uptime
          </div>
          <div className="mt-1 text-2xl font-bold">
            {boot
              ? `${Math.floor(boot.uptimeSec / 3600)}h ${Math.floor((boot.uptimeSec % 3600) / 60)}m`
              : '—'}
          </div>
          <div className="mt-1 text-xs text-sb-muted">Units P/L: pending settlement</div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-sb-muted">Live feed</h2>
        <div className="max-h-[52vh] overflow-auto rounded-xl border border-sb-line">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-sb-panel">
              <tr className="border-b border-sb-line text-sb-muted">
                <th className="p-2">Time</th>
                <th className="p-2">Sport / League</th>
                <th className="p-2">Game</th>
                <th className="p-2">Market / Period</th>
                <th className="p-2">NVP</th>
                <th className="p-2">Drop %</th>
                <th className="p-2">Soft odds</th>
                <th className="p-2">EV %</th>
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
                return (
                  <tr key={i} className="border-b border-sb-line/80 align-top">
                    <td className="p-2 whitespace-nowrap">{fmtTs(r.ts)}</td>
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
                    <td className={`p-2 ${evCls(r.evSign)}`}>{evTag}</td>
                    <td className={`p-2 ${betCls(r.bet)}`}>{r.bet}</td>
                    <td className="p-2 text-sb-muted">{r.detail}</td>
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
          {(boot?.accounts ?? []).map((a) => (
            <div
              key={a.id}
              className="rounded-xl border border-sb-line bg-[#1a222e] p-4 text-sm"
            >
              <div className="font-semibold">{a.username || a.id}</div>
              <div className="mt-2 flex justify-between text-sb-muted">
                <span>Active</span>
                <span className="text-slate-200">
                  <span
                    className={`mr-1 inline-block h-2 w-2 rounded-full ${a.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`}
                  />
                  {a.enabled ? 'enabled' : 'disabled'}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-sb-muted">
                <span>Proxy</span>
                <span className="text-slate-200">
                  {a.proxyActive ? `on · ${a.proxyMasked ?? ''}` : 'off'}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-sb-muted">
                <span>Placed / failed today</span>
                <span className="text-slate-200">
                  {a.betsPlacedToday} / {a.betsFailedToday}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-sb-muted">
                <span>Daily units P&amp;L</span>
                <span className="text-slate-200">—</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
