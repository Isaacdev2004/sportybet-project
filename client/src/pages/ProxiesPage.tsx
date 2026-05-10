import { useEffect, useState } from 'react';
import { fetchJson } from '../api';

export function ProxiesPage() {
  const [text, setText] = useState('Loading…');

  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const [p, boot] = await Promise.all([
          fetchJson<{ note?: string; iproyalConfigured?: boolean }>('/api/dashboard/proxies'),
          fetchJson<{ accounts?: unknown }>('/api/dashboard/bootstrap'),
        ]);
        if (!c)
          setText(
            JSON.stringify(
              {
                note: p.note,
                iproyalConfigured: p.iproyalConfigured,
                accounts: boot.accounts,
              },
              null,
              2,
            ),
          );
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
      <h1 className="text-xl font-semibold">Proxies</h1>
      <p className="text-sm text-sb-muted">
        Assign in <code className="text-sb-accent2">accounts.json</code>. iProyal auto-provisioning is
        not implemented in this build.
      </p>
      <pre className="max-h-[65vh] overflow-auto rounded-xl border border-sb-line bg-[#1a222e] p-4 text-xs leading-relaxed">
        {text}
      </pre>
    </div>
  );
}
