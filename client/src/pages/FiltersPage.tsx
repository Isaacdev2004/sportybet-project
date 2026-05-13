import { useEffect, useState } from 'react';
import { fetchJson } from '../api';

export function FiltersPage() {
  const [text, setText] = useState('Loading…');
  const [note, setNote] = useState('');

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const f = await fetchJson<{ engineFilters?: unknown; note?: string }>(
          '/api/dashboard/filters',
        );
        if (!c) {
          setNote(f.note ?? '');
          setText(JSON.stringify(f.engineFilters, null, 2));
        }
      } catch (e) {
        if (!c) setText(String(e));
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Engine filters</h1>
      <p className="text-sm text-slate-300 max-w-2xl">
        These values come from the server <code className="text-sb-accent2">.env</code> (global engine).{' '}
        <strong>Per-account</strong> sports, scenarios, direction, and minimum EV are editable on the{' '}
        <strong>Accounts</strong> page and saved to <code className="text-sb-accent2">accounts.json</code>. A
        signal must pass <em>both</em> engine rules and the account&apos;s rules before execution.
      </p>
      {note ? <p className="text-sm text-sb-muted">{note}</p> : null}
      <pre className="max-h-[65vh] overflow-auto rounded-xl border border-sb-line bg-[#1a222e] p-4 text-xs leading-relaxed">
        {text}
      </pre>
    </div>
  );
}
