import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson, fmtTs } from '../api';

interface BetRow {
  finishedAtMs: number;
  account: string;
  sport?: string;
  league?: string;
  game?: string;
  market?: string;
  period?: string;
  selection?: string;
  odds?: unknown;
  nvp?: unknown;
  evPct?: unknown;
  dropPct?: unknown;
  stake?: unknown;
  placement?: string;
  result?: string;
  plUnits?: unknown;
}

export function BetsPage() {
  const [rows, setRows] = useState<BetRow[]>([]);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const { rows: r } = await fetchJson<{ rows: BetRow[] }>('/api/dashboard/bets?limit=200');
      setRows(r);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const hay = [
        r.account,
        r.sport,
        r.league,
        r.game,
        r.market,
        r.period,
        r.selection,
        r.placement,
        r.result,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(s);
    });
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Bet history</h1>
      <p className="text-sm text-sb-muted">Newest first · execution ledger</p>
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search any column…"
          className="min-w-[220px] rounded-lg border border-sb-line bg-[#1a222e] px-3 py-2 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          className="rounded-lg border border-sb-line bg-sb-panel px-4 py-2 text-sm"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>
      <div className="max-h-[65vh] overflow-auto rounded-xl border border-sb-line">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-sb-panel">
            <tr className="border-b border-sb-line text-sb-muted">
              <th className="p-2">Date / time (UTC)</th>
              <th className="p-2">Account</th>
              <th className="p-2">Sport</th>
              <th className="p-2">League</th>
              <th className="p-2">Game</th>
              <th className="p-2">Market</th>
              <th className="p-2">Period</th>
              <th className="p-2">Selection</th>
              <th className="p-2">Odds</th>
              <th className="p-2">NVP</th>
              <th className="p-2">EV %</th>
              <th className="p-2">Drop %</th>
              <th className="p-2">Stake</th>
              <th className="p-2">Placement</th>
              <th className="p-2">Result</th>
              <th className="p-2">P&amp;L u</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i} className="border-b border-sb-line/80 align-top">
                <td className="p-2 whitespace-nowrap">{fmtTs(r.finishedAtMs)}</td>
                <td className="p-2">{r.account}</td>
                <td className="p-2">{r.sport}</td>
                <td className="p-2">{r.league}</td>
                <td className="p-2">{r.game}</td>
                <td className="p-2">{r.market}</td>
                <td className="p-2">{r.period}</td>
                <td className="p-2">{r.selection}</td>
                <td className="p-2">{String(r.odds ?? '—')}</td>
                <td className="p-2">{String(r.nvp ?? '—')}</td>
                <td className="p-2">{String(r.evPct ?? '—')}</td>
                <td className="p-2">{String(r.dropPct ?? '—')}</td>
                <td className="p-2">{String(r.stake ?? '—')}</td>
                <td className="p-2">{r.placement}</td>
                <td className="p-2">{r.result}</td>
                <td className="p-2">{String(r.plUnits ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
