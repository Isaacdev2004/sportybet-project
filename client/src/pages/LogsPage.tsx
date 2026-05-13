import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchJson, fmtTs } from '../api';

interface ActivityEntry {
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

type RangeKey = '1h' | '6h' | '24h' | 'all';
type LiveKey = 'both' | 'inplay' | 'prematch';
type EvKey = 'all' | 'plus' | 'minus';

function rangeCutoffMs(key: RangeKey, now: number): number {
  if (key === 'all') return 0;
  const h = key === '1h' ? 1 : key === '6h' ? 6 : 24;
  return now - h * 3_600_000;
}

export function LogsPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [range, setRange] = useState<RangeKey>('24h');
  const [live, setLive] = useState<LiveKey>('both');
  const [ev, setEv] = useState<EvKey>('all');
  const [logCat, setLogCat] = useState<string>('all');
  const [sport, setSport] = useState<string>('all');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const j = await fetchJson<{ entries: ActivityEntry[] }>('/api/dashboard/activity?limit=300');
      setEntries(j.entries ?? []);
      setLoadErr('');
    } catch (e) {
      setLoadErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 6000);
    return () => clearInterval(id);
  }, [load]);

  const now = Date.now();
  const fromMs = rangeCutoffMs(range, now);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (e.ts < fromMs) return false;
      if (live === 'inplay' && e.isLive !== true) return false;
      if (live === 'prematch' && e.isLive === true) return false;
      if (ev === 'plus' && (e.evPercent == null || e.evPercent <= 0)) return false;
      if (ev === 'minus' && (e.evPercent == null || e.evPercent >= 0)) return false;
      if (sport !== 'all') {
        const sk = (e.sport ?? '').toLowerCase();
        if (!sk.includes(sport)) return false;
      }
      const cat = e.kind ?? 'execution';
      if (logCat !== 'all') {
        if (logCat === 'bets') {
          if (cat !== 'execution' || !['placed', 'partial'].includes(e.outcome)) return false;
        } else if (logCat === 'skips') {
          if (cat === 'pipeline') return true;
          if (cat !== 'execution') return false;
          if (
            ![
              'filtered_out',
              'dedup_skipped',
              'execution_off',
              'no_enabled_accounts',
              'all_skipped',
            ].includes(e.outcome)
          )
            return false;
        } else if (logCat === 'pipeline') {
          if (cat !== 'pipeline') return false;
        } else if (logCat === 'activity') {
          if (cat !== 'activity') return false;
        } else if (logCat === 'errors') {
          if (cat === 'execution' && e.outcome === 'failed') return true;
          if (cat === 'activity' && e.level === 'error') return true;
          return false;
        } else if (logCat === 'sessions') {
          if (cat !== 'activity') return false;
          if (e.source !== 'session' && e.source !== 'playwright') return false;
        }
      }
      if (qq) {
        const blob = `${e.headline} ${e.detail} ${e.skipReason ?? ''} ${e.source ?? ''}`.toLowerCase();
        if (!blob.includes(qq)) return false;
      }
      return true;
    });
  }, [entries, fromMs, live, ev, sport, logCat, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Logs</h1>
          <p className="mt-1 max-w-3xl text-sm text-sb-muted">
            Unified stream: <strong>execution</strong> (ledger), <strong>pipeline</strong> (pre-execution
            skips with EV), and <strong>activity</strong> (session, keepalive, balance probes, queue
            events). Refreshes every few seconds.
          </p>
        </div>
        <Link className="text-sm text-sb-accent2 hover:underline" to="/">
          ← Dashboard
        </Link>
      </div>

      {loadErr ? <p className="text-sm text-amber-300">{loadErr}</p> : null}

      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs text-sb-muted">Time</span>
        {(['1h', '6h', '24h', 'all'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs ${
              range === k ? 'border-violet-500 bg-violet-500/15 text-slate-100' : 'border-sb-line text-sb-muted'
            }`}
            onClick={() => setRange(k)}
          >
            {k === 'all' ? 'All' : k}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs text-sb-muted">Live</span>
        {(['both', 'inplay', 'prematch'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs capitalize ${
              live === k ? 'border-violet-500 bg-violet-500/15 text-slate-100' : 'border-sb-line text-sb-muted'
            }`}
            onClick={() => setLive(k)}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs text-sb-muted">EV</span>
        {(['all', 'plus', 'minus'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs ${
              ev === k ? 'border-violet-500 bg-violet-500/15 text-slate-100' : 'border-sb-line text-sb-muted'
            }`}
            onClick={() => setEv(k)}
          >
            {k === 'plus' ? '+EV' : k === 'minus' ? '−EV' : 'All'}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs text-sb-muted">Type</span>
        {['all', 'bets', 'skips', 'pipeline', 'activity', 'errors', 'sessions'].map((k) => (
          <button
            key={k}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs capitalize ${
              logCat === k ? 'border-violet-500 bg-violet-500/15 text-slate-100' : 'border-sb-line text-sb-muted'
            }`}
            onClick={() => setLogCat(k)}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs text-sb-muted">Sport</span>
        {['all', 'tennis', 'basketball', 'soccer'].map((k) => (
          <button
            key={k}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs capitalize ${
              sport === k ? 'border-violet-500 bg-violet-500/15 text-slate-100' : 'border-sb-line text-sb-muted'
            }`}
            onClick={() => setSport(k)}
          >
            {k}
          </button>
        ))}
      </div>
      <label className="block max-w-md text-sm">
        <span className="text-sb-muted">Search</span>
        <input
          className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="team, market, skip reason…"
        />
      </label>

      <div className="rounded-xl border border-sb-line bg-sb-panel">
        <div className="max-h-[70vh] divide-y divide-sb-line overflow-auto">
          {filtered.length === 0 ? (
            <div className="p-6 text-sm text-sb-muted">No rows match these filters.</div>
          ) : (
            filtered.map((e, i) => (
              <div key={`${e.ts}-${i}-${e.headline}`} className="flex gap-3 p-3 text-sm">
                <div className="w-24 shrink-0 whitespace-nowrap text-xs text-sb-muted">
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
                    <span className="font-medium text-slate-100">{e.headline}</span>
                    {e.isLive === true ? (
                      <span className="rounded bg-sky-900/80 px-1 text-[10px] text-sky-200">Live</span>
                    ) : e.isLive === false ? (
                      <span className="text-[10px] text-sb-muted">Pre</span>
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
                    {e.sport ? (
                      <span className="text-xs capitalize text-sb-muted">{e.sport}</span>
                    ) : null}
                  </div>
                  {e.detail ? <div className="mt-1 text-xs text-sb-muted">{e.detail}</div> : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
