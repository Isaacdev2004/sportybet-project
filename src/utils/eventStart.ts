/**
 * PinnOdds drop rows often include `starts` (Unix). Used to drop alerts on likely finished events.
 */
export function parseEventStartUnixFromPayload(
  o: Record<string, unknown>,
): number | undefined {
  const keys = [
    'starts',
    'start_time',
    'startTime',
    'kickoff',
    'event_start',
    'eventStart',
    'scheduled',
    'scheduled_start',
  ];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      return v >= 1e12 ? Math.round(v / 1000) : Math.round(v);
    }
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v.trim());
      if (Number.isFinite(n) && n > 0) {
        return n >= 1e12 ? Math.round(n / 1000) : Math.round(n);
      }
    }
  }
  return undefined;
}
