import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { fetchJson } from '../api';

interface BootstrapHeader {
  sseConnected?: boolean;
  ingest?: { dropsPollActive?: boolean; lastPollOk?: boolean };
  engine?: {
    paused: boolean;
    executionEnabledFromEnv: boolean;
    effectiveProcessing: boolean;
    allowDuplicateBets?: boolean;
  };
  sportyBetApiHealth?: {
    ok: boolean;
    latencyMs: number;
    status?: number;
    error?: string;
    sessionMissing?: boolean;
    accountId?: string;
  };
}

const nav = [
  { to: '/', label: 'Dashboard' },
  { to: '/logs', label: 'Logs' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/settings', label: 'Settings' },
  { to: '/bets', label: 'Bets' },
  { to: '/stats', label: 'Stats' },
  { to: '/filters', label: 'Filters' },
  { to: '/proxies', label: 'Proxies' },
] as const;

export function Layout() {
  const location = useLocation();
  const [head, setHead] = useState<BootstrapHeader | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const b = await fetchJson<BootstrapHeader>('/api/dashboard/bootstrap');
        if (!cancelled) setHead(b);
      } catch {
        if (!cancelled) setHead(null);
      }
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  let pill = 'API…';
  let ok = false;
  if (head?.ingest?.dropsPollActive) {
    ok = head.ingest.lastPollOk !== false;
    pill =
      head.ingest.lastPollOk === false ? 'Drops poll · error' : 'Drops poll · OK';
  } else if (head) {
    ok = !!head.sseConnected;
    pill = head.sseConnected ? 'SSE · connected' : 'SSE · reconnecting';
  }

  const sb = head?.sportyBetApiHealth;
  const sbOk = sb?.ok === true;
  const sbLabel = sb?.sessionMissing
    ? 'SportyBet API · no session'
    : sb?.ok
      ? `SportyBet API · OK (${sb.latencyMs}ms)`
      : `SportyBet API · ${sb?.error ?? 'fail'}`;

  const paused = head?.engine?.paused === true;
  const allowDup = head?.engine?.allowDuplicateBets === true;

  const postControl = async (body: Record<string, unknown>) => {
    setControlBusy(true);
    try {
      const ctrl = await fetchJson<NonNullable<BootstrapHeader['engine']>>('/api/dashboard/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setHead((h) => (h ? { ...h, engine: ctrl } : null));
    } catch {
      /* ignore */
    } finally {
      setControlBusy(false);
    }
  };

  const setPaused = (next: boolean) => void postControl({ paused: next });
  const setAllowDuplicates = (next: boolean) => void postControl({ allowDuplicateBets: next });

  const aside = (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-56 shrink-0 flex-col border-r border-sb-line bg-[#0f1419] py-4 transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 ${
        navOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}
    >
      <div className="mb-3 flex items-center justify-between border-b border-sb-line px-4 pb-4">
        <div>
          <div className="font-bold tracking-tight text-sb-accent2">SportyBet</div>
          <div className="mt-1 text-xs text-sb-muted">Value engine · dashboard</div>
        </div>
        <button
          type="button"
          className="rounded-md p-2 text-sb-muted hover:bg-white/5 hover:text-slate-200 md:hidden"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        >
          ✕
        </button>
      </div>
      <nav className="flex flex-col gap-0.5">
        {nav.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `block border-l-[3px] px-4 py-2 text-sm transition-colors ${
                isActive
                  ? 'border-violet-500 bg-violet-500/10 text-slate-100'
                  : 'border-transparent text-sb-muted hover:bg-white/5 hover:text-slate-200'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-8 space-y-1 px-4 text-xs text-sb-muted">
        <a className="text-sb-accent2 hover:underline" href="/health">
          Health
        </a>
        <span className="mx-1">·</span>
        <a className="text-sb-accent2 hover:underline" href="/api/summary">
          API
        </a>
        <div className="pt-2">
          <a className="text-sb-accent2 hover:underline" href="/dashboard.html">
            Legacy HTML
          </a>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-[100dvh] min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-sb-bg">
      {navOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      {aside}
      <div className="flex min-w-0 w-full max-w-full flex-1 flex-col overflow-x-hidden">
        <header className="flex w-full max-w-full flex-wrap items-center justify-between gap-3 border-b border-sb-line bg-sb-panel px-4 py-3 md:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              className="shrink-0 rounded-md border border-sb-line p-2 text-slate-200 hover:bg-white/5 md:hidden"
              aria-label="Open menu"
              onClick={() => setNavOpen(true)}
            >
              <span className="block h-0.5 w-5 bg-current" />
              <span className="mt-1 block h-0.5 w-5 bg-current" />
              <span className="mt-1 block h-0.5 w-5 bg-current" />
            </button>
            <span
              className={`rounded-full border px-3 py-1 text-sm ${
                ok ? 'border-emerald-900 text-emerald-400' : 'border-sb-line text-sb-muted'
              }`}
            >
              {pill}
            </span>
            {sb ? (
              <span
                title={sb.error ?? (sb.sessionMissing ? 'Run npm run prove:login' : '')}
                className={`rounded-full border px-3 py-1 text-sm ${
                  sbOk ? 'border-emerald-900 text-emerald-400' : 'border-amber-900 text-amber-300'
                }`}
              >
                {sbLabel}
              </span>
            ) : null}
            {head?.engine ? (
              <span
                className={`rounded-full border px-3 py-1 text-sm ${
                  paused ? 'border-amber-900 text-amber-300' : 'border-slate-600 text-slate-300'
                }`}
              >
                {paused ? 'Bot paused' : 'Bot running'}
              </span>
            ) : null}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
            <button
              type="button"
              disabled={controlBusy || !head?.engine}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${
                paused
                  ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/30'
                  : 'border-rose-900 bg-rose-950/30 text-rose-200 hover:bg-rose-900/25'
              }`}
              onClick={() => setPaused(!paused)}
            >
              {paused ? 'Start bot' : 'Stop bot'}
            </button>
            <button
              type="button"
              disabled={controlBusy || !head?.engine}
              title="When off, identical selections within the dedup window are skipped once."
              className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40 ${
                allowDup
                  ? 'border-violet-700 bg-violet-950/40 text-violet-200 hover:bg-violet-900/25'
                  : 'border-sb-line bg-sb-panel text-slate-300 hover:bg-white/5'
              }`}
              onClick={() => setAllowDuplicates(!allowDup)}
            >
              Duplicates: {allowDup ? 'on' : 'off'}
            </button>
            <StreamHint />
          </div>
        </header>
        <main className="w-full max-w-full flex-1 overflow-x-hidden overflow-y-auto p-4 pb-8 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function StreamHint() {
  const [hint, setHint] = useState('');

  useEffect(() => {
    try {
      const es = new EventSource('/api/dashboard/stream');
      es.addEventListener('tick', (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent).data) as { ts?: number };
          if (d.ts)
            setHint(
              'Live stream · ' + new Date(d.ts).toISOString().replace('T', ' ').slice(0, 19),
            );
        } catch {
          /* ignore */
        }
      });
      es.onerror = () => setHint('Stream disconnected (polling still runs)');
      return () => es.close();
    } catch {
      setHint('EventSource unavailable');
      return undefined;
    }
  }, []);

  return (
    <span className="min-w-0 max-w-[11rem] truncate text-xs text-sb-muted md:max-w-none">
      {hint}
    </span>
  );
}
