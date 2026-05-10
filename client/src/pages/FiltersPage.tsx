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
      {note ? <p className="text-sm text-sb-muted">{note}</p> : null}
      <pre className="max-h-[65vh] overflow-auto rounded-xl border border-sb-line bg-[#1a222e] p-4 text-xs leading-relaxed">
        {text}
      </pre>
    </div>
  );
}
