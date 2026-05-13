import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../api';

type Scenario = 'total' | 'spread' | 'moneyline' | 'team_total' | 'other';
type Direction = 'both' | 'over' | 'under';

interface StakeRange {
  min: number;
  max: number;
}

interface AccountForm {
  id: string;
  username: string;
  password: string;
  proxy: string;
  enabled: boolean;
  startingBalance: number;
  stakeRanges: StakeRange[];
  filters: {
    allowedSports: string[];
    scenarios: Scenario[];
    direction: Direction;
    minEvPercent: string;
  };
}

const SCENARIO_OPTS: { key: Scenario; label: string }[] = [
  { key: 'total', label: 'Totals' },
  { key: 'spread', label: 'Spread' },
  { key: 'moneyline', label: 'Moneyline' },
  { key: 'team_total', label: 'Team total' },
  { key: 'other', label: 'Other' },
];

const SPORT_OPTS = [
  { key: 'tennis', label: 'Tennis' },
  { key: 'basketball', label: 'Basketball' },
];

function emptyAccount(): AccountForm {
  return {
    id: 'main',
    username: '',
    password: '',
    proxy: '',
    enabled: true,
    startingBalance: 0,
    stakeRanges: [{ min: 100, max: 500 }],
    filters: {
      allowedSports: ['tennis', 'basketball'],
      scenarios: ['total', 'spread'],
      direction: 'both',
      minEvPercent: '4',
    },
  };
}

function fromApi(a: {
  id: string;
  username: string;
  passwordSet?: boolean;
  proxy?: string;
  enabled?: boolean;
  startingBalance?: number;
  stakeRanges: StakeRange[];
  filters: {
    allowedSports: string[];
    scenarios: string[];
    direction: string;
    minEvPercent?: number;
  };
}): AccountForm {
  return {
    id: a.id,
    username: a.username,
    password: '',
    proxy: a.proxy ?? '',
    enabled: a.enabled !== false,
    startingBalance: a.startingBalance ?? 0,
    stakeRanges:
      Array.isArray(a.stakeRanges) && a.stakeRanges.length > 0
        ? a.stakeRanges.map((r) => ({ min: Number(r.min), max: Number(r.max) }))
        : [{ min: 100, max: 100 }],
    filters: {
      allowedSports: [...(a.filters?.allowedSports ?? [])],
      scenarios: (a.filters?.scenarios ?? ['total', 'spread']).filter(Boolean) as Scenario[],
      direction: (['both', 'over', 'under'].includes(a.filters?.direction)
        ? a.filters.direction
        : 'both') as Direction,
      minEvPercent:
        a.filters?.minEvPercent != null ? String(a.filters.minEvPercent) : '4',
    },
  };
}

function toSavePayload(forms: AccountForm[]) {
  return forms.map((f) => ({
    id: f.id.trim(),
    username: f.username.trim(),
    ...(f.password.trim() ? { password: f.password.trim() } : {}),
    proxy: f.proxy.trim() || undefined,
    enabled: f.enabled,
    startingBalance: Number.isFinite(f.startingBalance) ? f.startingBalance : 0,
    stakeRanges: f.stakeRanges.map((r) => ({
      min: Math.min(r.min, r.max),
      max: Math.max(r.min, r.max),
    })),
    filters: {
      allowedSports: f.filters.allowedSports,
      scenarios: f.filters.scenarios,
      direction: f.filters.direction,
      minEvPercent:
        f.filters.minEvPercent.trim() === ''
          ? undefined
          : Number(f.filters.minEvPercent),
    },
  }));
}

export function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountForm[]>([emptyAccount()]);
  const [status, setStatus] = useState<string>('Loading…');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await fetchJson<{ accounts: Record<string, unknown>[] }>(
        '/api/execution/accounts',
      );
      if (j.accounts?.length) {
        setAccounts(j.accounts.map((x) => fromApi(x as Parameters<typeof fromApi>[0])));
      } else {
        setAccounts([emptyAccount()]);
      }
      setStatus('');
    } catch (e) {
      setStatus(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (idx: number, patch: Partial<AccountForm>) => {
    setAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };

  const updateFilters = (idx: number, patch: Partial<AccountForm['filters']>) => {
    setAccounts((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, filters: { ...a.filters, ...patch } } : a)),
    );
  };

  const toggleSport = (idx: number, key: string) => {
    setAccounts((prev) => {
      const a = prev[idx];
      if (!a) return prev;
      const set = new Set(a.filters.allowedSports);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return prev.map((x, i) =>
        i === idx ? { ...x, filters: { ...x.filters, allowedSports: [...set] } } : x,
      );
    });
  };

  const toggleScenario = (idx: number, key: Scenario) => {
    setAccounts((prev) => {
      const a = prev[idx];
      if (!a) return prev;
      const set = new Set(a.filters.scenarios);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return prev.map((x, i) =>
        i === idx ? { ...x, filters: { ...x.filters, scenarios: [...set] } } : x,
      );
    });
  };

  const addRange = (idx: number) => {
    const a = accounts[idx];
    if (!a) return;
    update(idx, { stakeRanges: [...a.stakeRanges, { min: 100, max: 100 }] });
  };

  const removeRange = (idx: number, rIdx: number) => {
    const a = accounts[idx];
    if (!a || a.stakeRanges.length <= 1) return;
    update(idx, { stakeRanges: a.stakeRanges.filter((_, j) => j !== rIdx) });
  };

  const setRange = (idx: number, rIdx: number, field: 'min' | 'max', v: number) => {
    const a = accounts[idx];
    if (!a) return;
    const next = a.stakeRanges.map((r, j) => (j === rIdx ? { ...r, [field]: v } : r));
    update(idx, { stakeRanges: next });
  };

  const save = async () => {
    setSaving(true);
    setStatus('');
    try {
      await fetchJson<{ ok: boolean }>('/api/execution/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: toSavePayload(accounts) }),
      });
      setStatus('Saved. Reloading…');
      await load();
      setStatus('Saved.');
    } catch (e) {
      setStatus(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Accounts</h1>
      <p className="text-sm text-sb-muted max-w-2xl">
        Edit accounts below and click <strong>Save accounts</strong>. Password: leave blank to keep
        the current password. File path is set by <code className="text-sb-accent2">EXECUTION_ACCOUNTS_PATH</code> (default{' '}
        <code className="text-sb-accent2">data/accounts.json</code>).
      </p>
      {status ? (
        <p className={`text-sm ${status.startsWith('Saved') ? 'text-emerald-400' : 'text-amber-300'}`}>{status}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save accounts'}
        </button>
        <button
          type="button"
          className="rounded-lg border border-sb-line bg-sb-panel px-4 py-2 text-sm"
          onClick={() => void load()}
        >
          Reload
        </button>
        <button
          type="button"
          className="rounded-lg border border-sb-line bg-sb-panel px-4 py-2 text-sm"
          onClick={async () => {
            try {
              await fetch('/api/execution/accounts/reload', { method: 'POST' });
            } catch {
              /* ignore */
            }
            void load();
          }}
        >
          Reload server cache
        </button>
      </div>

      {accounts.map((acc, idx) => (
        <div
          key={`${acc.id}-${idx}`}
          className="rounded-xl border border-sb-line bg-[#1a222e] p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium text-slate-100">Account {idx + 1}</h2>
            <label className="flex items-center gap-2 text-sm text-sb-muted">
              <input
                type="checkbox"
                checked={acc.enabled}
                onChange={(e) => update(idx, { enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-sb-muted">Account id</span>
              <input
                className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
                value={acc.id}
                onChange={(e) => update(idx, { id: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="text-sb-muted">Username / phone</span>
              <input
                className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
                value={acc.username}
                onChange={(e) => update(idx, { username: e.target.value })}
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-sb-muted">Password (blank = keep unchanged)</span>
              <input
                type="password"
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
                value={acc.password}
                onChange={(e) => update(idx, { password: e.target.value })}
                placeholder="••••••••"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-sb-muted">Proxy (optional)</span>
              <input
                className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm font-mono text-xs"
                value={acc.proxy}
                onChange={(e) => update(idx, { proxy: e.target.value })}
                placeholder="http://user:pass@host:port"
              />
            </label>
            <label className="block text-sm">
              <span className="text-sb-muted">Starting balance (reference)</span>
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
                value={acc.startingBalance}
                onChange={(e) =>
                  update(idx, { startingBalance: Number(e.target.value) || 0 })
                }
              />
            </label>
          </div>

          <div>
            <h3 className="text-sm font-medium text-slate-200 mb-2">Stake ranges (NGN)</h3>
            <p className="text-xs text-sb-muted mb-2">
              Each range = one stake pick per signal. Keep within your SportyBet limits.
            </p>
            <div className="space-y-2">
              {acc.stakeRanges.map((r, rIdx) => (
                <div key={rIdx} className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    className="w-28 rounded-lg border border-sb-line bg-sb-bg px-2 py-1.5 text-sm"
                    value={r.min}
                    onChange={(e) =>
                      setRange(idx, rIdx, 'min', Number(e.target.value) || 0)
                    }
                  />
                  <span className="text-sb-muted">—</span>
                  <input
                    type="number"
                    className="w-28 rounded-lg border border-sb-line bg-sb-bg px-2 py-1.5 text-sm"
                    value={r.max}
                    onChange={(e) =>
                      setRange(idx, rIdx, 'max', Number(e.target.value) || 0)
                    }
                  />
                  <button
                    type="button"
                    className="rounded border border-red-900/60 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
                    disabled={acc.stakeRanges.length <= 1}
                    onClick={() => removeRange(idx, rIdx)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-sm text-violet-400 hover:underline"
                onClick={() => addRange(idx)}
              >
                + Add range
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-slate-200 mb-2">Per-account filters</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-sb-muted">Min EV % (this account)</span>
                <input
                  type="number"
                  step="0.1"
                  className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
                  value={acc.filters.minEvPercent}
                  onChange={(e) => updateFilters(idx, { minEvPercent: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-sb-muted">Direction</span>
                <select
                  className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
                  value={acc.filters.direction}
                  onChange={(e) =>
                    updateFilters(idx, { direction: e.target.value as Direction })
                  }
                >
                  <option value="both">Both over / under</option>
                  <option value="over">Over only</option>
                  <option value="under">Under only</option>
                </select>
              </label>
            </div>
            <div className="mt-3">
              <div className="text-xs text-sb-muted mb-1">Sports</div>
              <div className="flex flex-wrap gap-3">
                {SPORT_OPTS.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={acc.filters.allowedSports.includes(s.key)}
                      onChange={() => toggleSport(idx, s.key)}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-3">
              <div className="text-xs text-sb-muted mb-1">Market types</div>
              <div className="flex flex-wrap gap-3">
                {SCENARIO_OPTS.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={acc.filters.scenarios.includes(s.key)}
                      onChange={() => toggleScenario(idx, s.key)}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}

      <p className="text-xs text-sb-muted">
        Advanced per-line NVP / drop caps use engine env and global filters. We can extend this form
        once you confirm the exact rules per account.
      </p>
    </div>
  );
}
