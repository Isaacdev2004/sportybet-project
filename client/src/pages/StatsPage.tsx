import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../api';

interface Agg {
  accountAttempts: number;
  executionCycles: number;
  placedSuccess: number;
  placedFailed: number;
  placedSkipped: number;
  totalStakedSuccess: number;
  avgEvPlaced: number | null;
  avgOddsPlaced: number | null;
  avgNvpPlaced: number | null;
  won: number;
  lost: number;
  pending: number;
  voided: number;
  perAccount: Record<
    string,
    { attempts: number; success: number; failed: number; skipped: number; staked: number }
  >;
}

interface StatsResp {
  range: string;
  aggregate: Agg;
  winRate: number | null;
  settlementNote?: string;
}

export function StatsPage() {
  const [range, setRange] = useState('today');
  const [sport, setSport] = useState('all');
  const [market, setMarket] = useState('all');
  const [period, setPeriod] = useState('');
  const [data, setData] = useState<StatsResp | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ range, sport, market, period });
    try {
      const s = await fetchJson<StatsResp>('/api/dashboard/stats?' + qs.toString());
      setData(s);
    } catch {
      setData(null);
    }
  }, [range, sport, market, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const a = data?.aggregate;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Statistics</h1>
      {data?.settlementNote ? (
        <p className="text-sm text-sb-muted">{data.settlementNote}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="text-sb-muted">Range</label>
        <select
          className="rounded-lg border border-sb-line bg-[#1a222e] px-2 py-1"
          value={range}
          onChange={(e) => setRange(e.target.value)}
        >
          <option value="today">Today (UTC)</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
          <option value="all">All (tail)</option>
        </select>
        <label className="text-sb-muted">Sport</label>
        <select
          className="rounded-lg border border-sb-line bg-[#1a222e] px-2 py-1"
          value={sport}
          onChange={(e) => setSport(e.target.value)}
        >
          <option value="all">All</option>
          <option value="basketball">Basketball</option>
          <option value="tennis">Tennis</option>
        </select>
        <label className="text-sb-muted">Market</label>
        <select
          className="rounded-lg border border-sb-line bg-[#1a222e] px-2 py-1"
          value={market}
          onChange={(e) => setMarket(e.target.value)}
        >
          <option value="all">All</option>
          <option value="total">Totals</option>
          <option value="spread">Spread</option>
          <option value="moneyline">Moneyline</option>
        </select>
        <label className="text-sb-muted">Period</label>
        <input
          className="w-28 rounded-lg border border-sb-line bg-[#1a222e] px-2 py-1"
          placeholder="e.g. Q1"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
        <button
          type="button"
          className="rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-1.5 text-sm text-white"
          onClick={() => void load()}
        >
          Apply
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total bets (attempts)" val={a?.accountAttempts} />
        <StatCard
          title="Placed / failed / skipped"
          val={a ? `${a.placedSuccess} / ${a.placedFailed} / ${a.placedSkipped}` : undefined}
        />
        <StatCard
          title="Win rate"
          val={data?.winRate != null ? `${data.winRate.toFixed(1)}%` : '—'}
          sub="Won/lost pending settlement"
        />
        <StatCard title="ROI" val="—" sub="Needs P&amp;L" />
        <StatCard
          title="Total staked (placed)"
          val={
            a?.totalStakedSuccess != null
              ? (typeof a.totalStakedSuccess === 'number'
                  ? a.totalStakedSuccess.toFixed(2)
                  : String(a.totalStakedSuccess))
              : undefined
          }
        />
        <StatCard
          title="Avg EV% / odds / NVP"
          val={a?.avgEvPlaced != null ? a.avgEvPlaced.toFixed(2) : '—'}
          sub={
            a
              ? `Odds ${a.avgOddsPlaced != null ? a.avgOddsPlaced.toFixed(2) : '—'} · NVP ${a.avgNvpPlaced != null ? a.avgNvpPlaced.toFixed(3) : '—'}`
              : undefined
          }
        />
        <StatCard
          title="Won / lost / pending / void"
          val={a ? `${a.won} / ${a.lost} / ${a.pending} / ${a.voided}` : undefined}
        />
      </div>

      <h2 className="text-sm font-medium text-sb-muted">Per-account</h2>
      <div className="max-h-72 overflow-auto rounded-xl border border-sb-line">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-sb-panel">
            <tr className="border-b border-sb-line text-sb-muted">
              <th className="p-2">Account</th>
              <th className="p-2">Attempts</th>
              <th className="p-2">Placed</th>
              <th className="p-2">Failed</th>
              <th className="p-2">Skipped</th>
              <th className="p-2">Staked</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(a?.perAccount ?? {})
              .sort()
              .map((k) => {
                const x = a!.perAccount[k]!;
                return (
                  <tr key={k} className="border-b border-sb-line/80">
                    <td className="p-2">{k}</td>
                    <td className="p-2">{x.attempts}</td>
                    <td className="p-2">{x.success}</td>
                    <td className="p-2">{x.failed}</td>
                    <td className="p-2">{x.skipped}</td>
                    <td className="p-2">{x.staked}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  title,
  val,
  sub,
}: {
  title: string;
  val?: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-sb-line bg-sb-panel p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-sb-muted">{title}</div>
      <div className="mt-1 text-2xl font-bold">{val ?? '—'}</div>
      {sub ? <div className="mt-1 text-xs text-sb-muted">{sub}</div> : null}
    </div>
  );
}
