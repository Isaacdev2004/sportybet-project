import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../api';

type Tab = 'inplay' | 'prematch';

type MarketKey = 'moneyline' | 'total' | 'spread' | 'team_total';
type OutcomeKey = 'home' | 'away' | 'draw' | 'over' | 'under';

interface IndividualRule {
  id: string;
  order: number;
  name: string;
  sport: string;
  markets: MarketKey[];
  outcomes: OutcomeKey[];
  minLine?: number;
  maxLine?: number;
  periodNames: string[];
}

const MARKETS: { key: MarketKey; label: string }[] = [
  { key: 'moneyline', label: 'Moneyline' },
  { key: 'total', label: 'Total' },
  { key: 'spread', label: 'Spread' },
  { key: 'team_total', label: 'Team total' },
];

const OUTCOMES: { key: OutcomeKey; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'away', label: 'Away' },
  { key: 'draw', label: 'Draw' },
  { key: 'over', label: 'Over' },
  { key: 'under', label: 'Under' },
];

const SPORTS = [
  { value: '', label: 'Any sport' },
  { value: 'tennis', label: 'Tennis' },
  { value: 'basketball', label: 'Basketball' },
  { value: 'soccer', label: 'Soccer' },
];

function emptyRule(order: number): IndividualRule {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    order,
    name: '',
    sport: '',
    markets: [],
    outcomes: [],
    periodNames: [],
  };
}

export function FiltersPage() {
  const [globalText, setGlobalText] = useState('Loading…');
  const [globalNote, setGlobalNote] = useState('');
  const [tab, setTab] = useState<Tab>('inplay');
  const [inplay, setInplay] = useState<IndividualRule[]>([]);
  const [prematch, setPrematch] = useState<IndividualRule[]>([]);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; mode: Tab; rule: IndividualRule | null }>({
    open: false,
    mode: 'inplay',
    rule: null,
  });

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const f = await fetchJson<{ engineFilters?: unknown; note?: string }>(
          '/api/dashboard/filters',
        );
        if (!c) {
          setGlobalNote(f.note ?? '');
          setGlobalText(JSON.stringify(f.engineFilters, null, 2));
        }
      } catch (e) {
        if (!c) setGlobalText(String(e));
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  const loadIndividual = useCallback(async () => {
    try {
      const j = await fetchJson<{ inplay: IndividualRule[]; prematch: IndividualRule[] }>(
        '/api/dashboard/individual-filters',
      );
      setInplay(Array.isArray(j.inplay) ? j.inplay : []);
      setPrematch(Array.isArray(j.prematch) ? j.prematch : []);
      setStatus('');
    } catch (e) {
      setStatus(String(e));
    }
  }, []);

  useEffect(() => {
    void loadIndividual();
  }, [loadIndividual]);

  const saveAll = async (nextInplay: IndividualRule[], nextPrematch: IndividualRule[]) => {
    setSaving(true);
    setStatus('');
    try {
      await fetchJson('/api/dashboard/individual-filters', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inplay: nextInplay, prematch: nextPrematch }),
      });
      await loadIndividual();
      setStatus('Saved individual filters.');
    } catch (e) {
      setStatus(String(e));
    } finally {
      setSaving(false);
    }
  };

  const currentList = tab === 'inplay' ? inplay : prematch;

  const openAdd = () => {
    const list = tab === 'inplay' ? inplay : prematch;
    const order = list.length > 0 ? Math.max(...list.map((r) => r.order)) + 1 : 0;
    setModal({ open: true, mode: tab, rule: emptyRule(order) });
  };

  const openEdit = (r: IndividualRule) => {
    setModal({
      open: true,
      mode: tab,
      rule: {
        ...r,
        markets: [...r.markets],
        outcomes: [...r.outcomes],
        periodNames: [...(r.periodNames ?? [])],
      },
    });
  };

  const persistModal = () => {
    if (!modal.rule) return;
    const r = modal.rule;
    if (!r.name.trim()) {
      setStatus('Filter name is required.');
      return;
    }
    const list = modal.mode === 'inplay' ? [...inplay] : [...prematch];
    const idx = list.findIndex((x) => x.id === r.id);
    if (idx >= 0) list[idx] = r;
    else list.push(r);
    list.sort((a, b) => a.order - b.order);
    if (modal.mode === 'inplay') {
      void saveAll(list, prematch);
    } else {
      void saveAll(inplay, list);
    }
    setModal({ open: false, mode: 'inplay', rule: null });
  };

  const removeRow = (id: string) => {
    if (!confirm('Remove this filter?')) return;
    if (tab === 'inplay') {
      void saveAll(
        inplay.filter((x) => x.id !== id),
        prematch,
      );
    } else {
      void saveAll(
        inplay,
        prematch.filter((x) => x.id !== id),
      );
    }
  };

  const updateModalRule = (patch: Partial<IndividualRule>) => {
    setModal((m) => (m.rule ? { ...m, rule: { ...m.rule, ...patch } } : m));
  };

  const toggleModalMarket = (key: MarketKey) => {
    setModal((m) => {
      if (!m.rule) return m;
      const set = new Set(m.rule.markets);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...m, rule: { ...m.rule, markets: [...set] } };
    });
  };

  const toggleModalOutcome = (key: OutcomeKey) => {
    setModal((m) => {
      if (!m.rule) return m;
      const set = new Set(m.rule.outcomes);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...m, rule: { ...m.rule, outcomes: [...set] } };
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Filters</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          <strong>Individual filters</strong> (below) are saved to{' '}
          <code className="text-sb-accent2">data/individual_filters.json</code> and apply{' '}
          <em>after</em> global engine thresholds and <em>before</em> deduplication. If a tab has{' '}
          <strong>one or more</strong> rules, each opportunity must match <strong>at least one</strong>{' '}
          rule for that mode (Inplay vs Prematch). Empty list = no extra restriction.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-sb-muted">
          <strong>Global engine filters</strong> still come from <code className="text-sb-accent2">.env</code>{' '}
          (shown at the bottom). Per-account sports / scenarios / min EV remain on the{' '}
          <strong>Accounts</strong> page.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-sb-line pb-3">
        {(['inplay', 'prematch'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`rounded-lg px-4 py-2 text-sm font-medium capitalize ${
              tab === t
                ? 'bg-violet-600 text-white'
                : 'border border-sb-line bg-sb-panel text-sb-muted hover:bg-white/5'
            }`}
            onClick={() => setTab(t)}
          >
            {t === 'inplay' ? 'Inplay' : 'Prematch'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-slate-100">
          Individual filters — {tab === 'inplay' ? 'Inplay' : 'Prematch'}
        </h2>
        <button
          type="button"
          className="rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white"
          onClick={openAdd}
        >
          + Add filter
        </button>
      </div>

      {status ? (
        <p className={`text-sm ${status.startsWith('Saved') ? 'text-emerald-400' : 'text-amber-300'}`}>
          {status}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-sb-line">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead className="bg-sb-panel text-xs uppercase text-sb-muted">
            <tr>
              <th className="p-2">Order</th>
              <th className="p-2">Name</th>
              <th className="p-2">Sport</th>
              <th className="p-2">Markets</th>
              <th className="p-2">Outcomes</th>
              <th className="p-2">Line</th>
              <th className="p-2">Period hints</th>
              <th className="p-2"> </th>
            </tr>
          </thead>
          <tbody>
            {currentList.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-4 text-sb-muted">
                  No rules yet — add a filter or leave empty to allow all lines through (subject to
                  global + account rules).
                </td>
              </tr>
            ) : (
              [...currentList].sort((a, b) => a.order - b.order).map((r) => (
                <tr key={r.id} className="border-t border-sb-line">
                  <td className="p-2 font-mono text-xs text-sb-muted">{r.order}</td>
                  <td className="p-2 font-medium">{r.name}</td>
                  <td className="p-2 capitalize">{r.sport || 'Any'}</td>
                  <td className="p-2 text-xs">{r.markets.join(', ') || 'Any'}</td>
                  <td className="p-2 text-xs">{r.outcomes.join(', ') || 'Any'}</td>
                  <td className="p-2 text-xs text-sb-muted">
                    {r.minLine != null || r.maxLine != null
                      ? `${r.minLine ?? '−∞'} – ${r.maxLine ?? '+∞'}`
                      : 'Any'}
                  </td>
                  <td className="p-2 text-xs text-sb-muted">
                    {r.periodNames?.length ? r.periodNames.join(', ') : 'Any'}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <button
                      type="button"
                      className="mr-2 text-violet-400 hover:underline"
                      onClick={() => openEdit(r)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-red-400 hover:underline"
                      onClick={() => removeRow(r.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-medium text-slate-100">Global engine filters (.env)</h2>
        {globalNote ? <p className="mb-2 text-sm text-sb-muted">{globalNote}</p> : null}
        <pre className="max-h-[45vh] overflow-auto rounded-xl border border-sb-line bg-[#1a222e] p-4 text-xs leading-relaxed">
          {globalText}
        </pre>
      </div>

      {modal.open && modal.rule ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-sb-line bg-[#151b24] p-5 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">
                  {(modal.mode === 'inplay' ? inplay : prematch).some((x) => x.id === modal.rule!.id)
                    ? 'Edit filter'
                    : 'Add filter'}
                </h3>
                <p className="text-xs text-sb-muted">
                  Mode: <strong className="text-slate-300">{modal.mode}</strong>. Empty markets /
                  outcomes = match any.
                </p>
              </div>
              <button
                type="button"
                className="rounded-md p-2 text-sb-muted hover:bg-white/10"
                aria-label="Close"
                onClick={() => setModal({ open: false, mode: 'inplay', rule: null })}
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="text-sb-muted">Filter name</span>
                <input
                  className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
                  value={modal.rule.name}
                  onChange={(e) => updateModalRule({ name: e.target.value })}
                  placeholder="e.g. Basketball Under Strategy"
                />
              </label>
              <label className="block text-sm">
                <span className="text-sb-muted">Order</span>
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
                  value={modal.rule.order}
                  onChange={(e) => updateModalRule({ order: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-sb-muted">Sport</span>
                <select
                  className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
                  value={modal.rule.sport}
                  onChange={(e) => updateModalRule({ sport: e.target.value })}
                >
                  {SPORTS.map((s) => (
                    <option key={s.value || 'any'} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <div className="text-xs text-sb-muted">Markets</div>
                <div className="mt-1 flex flex-wrap gap-3">
                  {MARKETS.map((m) => (
                    <label key={m.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={modal.rule!.markets.includes(m.key)}
                        onChange={() => toggleModalMarket(m.key)}
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="mt-1 text-xs text-violet-400 hover:underline"
                  onClick={() => updateModalRule({ markets: [] })}
                >
                  Clear markets
                </button>
              </div>
              <div>
                <div className="text-xs text-sb-muted">Outcomes</div>
                <div className="mt-1 flex flex-wrap gap-3">
                  {OUTCOMES.map((m) => (
                    <label key={m.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={modal.rule!.outcomes.includes(m.key)}
                        onChange={() => toggleModalOutcome(m.key)}
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="mt-1 text-xs text-violet-400 hover:underline"
                  onClick={() => updateModalRule({ outcomes: [] })}
                >
                  Clear outcomes
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-sb-muted">Min line (optional)</span>
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
                    value={modal.rule.minLine ?? ''}
                    onChange={(e) =>
                      updateModalRule({
                        minLine: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    placeholder="e.g. 220.5"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-sb-muted">Max line (optional)</span>
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
                    value={modal.rule.maxLine ?? ''}
                    onChange={(e) =>
                      updateModalRule({
                        maxLine: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="text-sb-muted">Period hints (comma-separated, optional)</span>
                <input
                  className="mt-1 w-full rounded-lg border border-sb-line bg-sb-bg px-3 py-2 text-sm"
                  value={modal.rule.periodNames.join(', ')}
                  onChange={(e) =>
                    updateModalRule({
                      periodNames: e.target.value
                        .split(',')
                        .map((s) => s.trim().toLowerCase())
                        .filter(Boolean),
                    })
                  }
                  placeholder="e.g. game, 1st half"
                />
              </label>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-sb-line px-4 py-2 text-sm"
                onClick={() => setModal({ open: false, mode: 'inplay', rule: null })}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                onClick={() => persistModal()}
              >
                {saving ? 'Saving…' : 'Save filter'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
