import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../api';

export function AccountsPage() {
  const [text, setText] = useState('Loading…');

  const load = useCallback(async () => {
    try {
      const j = await fetchJson<unknown>('/api/execution/accounts');
      setText(JSON.stringify(j, null, 2));
    } catch (e) {
      setText(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Accounts</h1>
      <p className="text-sm text-sb-muted">
        Edit <code className="text-sb-accent2">data/accounts.json</code> then reload.
      </p>
      <button
        type="button"
        className="rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white"
        onClick={async () => {
          try {
            await fetch('/api/execution/accounts/reload', { method: 'POST' });
          } catch {
            /* ignore */
          }
          void load();
        }}
      >
        Reload accounts
      </button>
      <pre className="max-h-[65vh] overflow-auto rounded-xl border border-sb-line bg-[#1a222e] p-4 text-xs leading-relaxed">
        {text}
      </pre>
    </div>
  );
}
