import { useEffect, useState } from 'react';
import { fetchJson } from '../api';

export function SettingsPage() {
  const [text, setText] = useState('Loading…');

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const [boot, ex] = await Promise.all([
          fetchJson<{ pinnacle?: unknown }>('/api/dashboard/bootstrap'),
          fetchJson<unknown>('/api/execution/settings'),
        ]);
        if (!c) setText(JSON.stringify({ execution: ex, pinnacle: boot.pinnacle }, null, 2));
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
      <h1 className="text-xl font-semibold">Settings</h1>
      <p className="text-sm text-sb-muted">
        Read-only snapshot. Change <code className="text-sb-accent2">.env</code> and restart the
        process.
      </p>
      <pre className="max-h-[65vh] overflow-auto rounded-xl border border-sb-line bg-[#1a222e] p-4 text-xs leading-relaxed">
        {text}
      </pre>
    </div>
  );
}
