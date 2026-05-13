export type ActivityEventSource =
  | 'session'
  | 'playwright'
  | 'balance'
  | 'execution'
  | 'pipeline'
  | 'system';

export type ActivityEventLevel = 'info' | 'ok' | 'warn' | 'error';

export interface ActivityEvent {
  id: string;
  ts: number;
  source: ActivityEventSource;
  level: ActivityEventLevel;
  accountId?: string;
  headline: string;
  detail: string;
}

const MAX = 500;
const ring: ActivityEvent[] = [];

const lastBalanceLogAt = new Map<string, number>();

export function appendActivityEvent(
  e: Omit<ActivityEvent, 'id' | 'ts'> & { ts?: number },
): void {
  const id = `${e.source}-${(e.ts ?? Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
  const row: ActivityEvent = {
    id,
    ts: e.ts ?? Date.now(),
    source: e.source,
    level: e.level,
    accountId: e.accountId,
    headline: e.headline,
    detail: e.detail,
  };
  ring.unshift(row);
  while (ring.length > MAX) ring.pop();
}

/** Rate-limit balance lines so a healthy 20s poll does not flood the log. */
export function appendBalanceActivityIfDue(
  accountId: string,
  minGapMs: number,
  build: () => Omit<ActivityEvent, 'id' | 'ts'> & { ts?: number },
): void {
  const now = Date.now();
  const last = lastBalanceLogAt.get(accountId) ?? 0;
  if (now - last < minGapMs) return;
  lastBalanceLogAt.set(accountId, now);
  appendActivityEvent(build());
}

export function getActivityEvents(max = 200): ActivityEvent[] {
  return ring.slice(0, Math.min(max, MAX));
}

export function activityEventToDashboardRow(e: ActivityEvent): {
  ts: number;
  outcome: string;
  skipReason?: string;
  headline: string;
  detail: string;
  evPercent: number | null;
  sport: string | null;
  isLive: boolean | null;
  id: string;
  level: ActivityEventLevel;
} {
  return {
    id: e.id,
    ts: e.ts,
    outcome: e.source,
    skipReason: e.level !== 'info' ? e.level : undefined,
    headline: e.headline,
    detail: e.accountId ? `[${e.accountId}] ${e.detail}` : e.detail,
    evPercent: null,
    sport: null,
    isLive: null,
    level: e.level,
  };
}
