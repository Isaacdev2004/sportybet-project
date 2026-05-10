import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { fetchJson } from '../api';

interface BootstrapHeader {
  sseConnected?: boolean;
  ingest?: { dropsPollActive?: boolean; lastPollOk?: boolean };
}

const nav = [
  { to: '/', label: 'Dashboard' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/settings', label: 'Settings' },
  { to: '/bets', label: 'Bets' },
  { to: '/stats', label: 'Stats' },
  { to: '/filters', label: 'Filters' },
  { to: '/proxies', label: 'Proxies' },
] as const;

export function Layout() {
  const [head, setHead] = useState<BootstrapHeader | null>(null);

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

  return (
    <div className="flex min-h-screen bg-sb-bg">
      <aside className="w-56 shrink-0 border-r border-sb-line bg-[#0f1419] py-4">
        <div className="border-b border-sb-line px-4 pb-4 mb-3">
          <div className="font-bold text-sb-accent2 tracking-tight">SportyBet</div>
          <div className="text-xs text-sb-muted mt-1">Value engine · dashboard</div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `block px-4 py-2 text-sm border-l-[3px] transition-colors ${
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
        <div className="mt-8 px-4 text-xs text-sb-muted space-y-1">
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
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-sb-line bg-sb-panel px-6 py-3">
          <span
            className={`rounded-full border px-3 py-1 text-sm ${
              ok ? 'border-emerald-900 text-emerald-400' : 'border-sb-line text-sb-muted'
            }`}
          >
            {pill}
          </span>
          <StreamHint />
        </header>
        <main className="flex-1 overflow-auto p-6">
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

  return <span className="text-xs text-sb-muted">{hint}</span>;
}
