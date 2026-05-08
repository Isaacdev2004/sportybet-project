import { env } from '../config/env.js';
import type { OddsDropSignal } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { extractDropPayloadExtras } from '../utils/dropPayloadExtras.js';
import { parseEventStartUnixFromPayload } from '../utils/eventStart.js';
import { delay } from '../utils/helpers.js';
import {
  reportPollTick,
  setDropsPollActive,
  setPollRunning,
} from './ingestStatus.js';

/** Map PinnOdds `GET /api/drops` row → pipeline signal shape. */
export function normalizeApiDropToSignal(
  raw: Record<string, unknown>,
  receivedAtMs: number,
): OddsDropSignal | undefined {
  const eventRaw = raw.event_id ?? raw.eventId ?? raw.id;
  let parentId: string | undefined;
  if (typeof eventRaw === 'number' && Number.isFinite(eventRaw)) {
    parentId = String(Math.trunc(eventRaw));
  } else if (typeof eventRaw === 'string' && /^\d+$/.test(eventRaw.trim())) {
    parentId = eventRaw.trim();
  }

  const periodRaw = raw.period;
  const period =
    typeof periodRaw === 'number' && Number.isFinite(periodRaw)
      ? Math.trunc(periodRaw)
      : undefined;

  const fromVal = raw.from ?? raw.from_price;
  const toVal = raw.to ?? raw.to_price;
  let prevOdds: number | undefined;
  let currentOdds: number | undefined;
  if (typeof fromVal === 'number' && Number.isFinite(fromVal)) prevOdds = fromVal;
  else if (typeof fromVal === 'string') {
    const n = Number(fromVal);
    if (Number.isFinite(n)) prevOdds = n;
  }
  if (typeof toVal === 'number' && Number.isFinite(toVal)) currentOdds = toVal;
  else if (typeof toVal === 'string') {
    const n = Number(toVal);
    if (Number.isFinite(n)) currentOdds = n;
  }

  const pts = raw.points ?? raw.point;
  let line: string | number | undefined;
  if (typeof pts === 'number' && Number.isFinite(pts)) line = pts;
  else if (typeof pts === 'string' && pts.trim()) {
    const n = Number(pts);
    line = Number.isFinite(n) ? n : pts;
  }

  const designation =
    typeof raw.side === 'string'
      ? raw.side
      : typeof raw.outcome === 'string'
        ? raw.outcome
        : undefined;

  const periodName =
    typeof raw.period_name === 'string'
      ? raw.period_name.trim()
      : typeof raw.periodName === 'string'
        ? raw.periodName.trim()
        : undefined;

  const signal: OddsDropSignal = {
    raw,
    receivedAtMs,
    sport:
      typeof raw.sport === 'string'
        ? raw.sport
        : typeof raw.sport_name === 'string'
          ? raw.sport_name
          : undefined,
    league: typeof raw.league === 'string' ? raw.league : undefined,
    home: typeof raw.home === 'string' ? raw.home : undefined,
    away: typeof raw.away === 'string' ? raw.away : undefined,
    market: typeof raw.market === 'string' ? raw.market : undefined,
    sector: typeof raw.sect === 'string' ? raw.sect : undefined,
    line,
    designation,
    prevOdds,
    currentOdds,
    parentId,
    period,
    periodName,
    isLive:
      typeof raw.is_live === 'boolean'
        ? raw.is_live
        : typeof raw.isLive === 'boolean'
          ? raw.isLive
          : undefined,
    providerNvp: (() => {
      const v = raw.nvp ?? raw.fair_nvp ?? raw.fairNvp ?? raw.true_odds;
      if (typeof v === 'number' && Number.isFinite(v) && v > 1) return v;
      if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n) && n > 1) return n;
      }
      return undefined;
    })(),
    eventStartUnixSec: parseEventStartUnixFromPayload(raw),
    ...extractDropPayloadExtras(raw),
  };

  if (!parentId && prevOdds === undefined && currentOdds === undefined) {
    return undefined;
  }
  return signal;
}

function fingerprintDrop(d: Record<string, unknown>): string {
  const ev = d.event_id ?? d.eventId ?? d.id ?? '';
  const m = d.market ?? '';
  const p = d.period ?? '';
  const side = d.side ?? d.outcome ?? '';
  const pts = d.points ?? d.point ?? '';
  const fr = d.from ?? d.from_price ?? '';
  const to = d.to ?? d.to_price ?? '';
  return `${ev}|${m}|${p}|${side}|${pts}|${fr}|${to}`;
}

/** Bounded dedupe ring so long runs do not leak memory. */
export class DropsFingerprintDeduper {
  private readonly seen = new Set<string>();
  private readonly queue: string[] = [];
  private readonly maxKeys: number;

  constructor(maxKeys = 5000) {
    this.maxKeys = maxKeys;
  }

  /** @returns true if this fingerprint is new (should process) */
  firstTime(fp: string): boolean {
    if (this.seen.has(fp)) return false;
    this.seen.add(fp);
    this.queue.push(fp);
    while (this.queue.length > this.maxKeys) {
      const oldest = this.queue.shift();
      if (oldest) this.seen.delete(oldest);
    }
    return true;
  }

  /** Seed cache without emitting (cold start avoids flooding Telegram on backlog). */
  remember(fp: string): void {
    if (this.seen.has(fp)) return;
    this.seen.add(fp);
    this.queue.push(fp);
    while (this.queue.length > this.maxKeys) {
      const oldest = this.queue.shift();
      if (oldest) this.seen.delete(oldest);
    }
  }
}

function trimBase(base: string): string {
  return base.replace(/\/+$/, '');
}

function pinnacleJsonHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  const key = env.pinnacle.apiKey.trim();
  if (key) h['x-portal-apikey'] = key;
  return h;
}

/**
 * Trial-tier path: periodic `GET /api/drops` instead of SSE. Stay conservative on interval
 * to respect tight daily quotas (e.g. 100/day trial).
 */
export class PinnoddsDropsPoller {
  private readonly deduper = new DropsFingerprintDeduper();
  private stopRequested = false;
  private abortController: AbortController | null = null;
  private coldBoot = true;

  constructor(private readonly onDrop: (signal: OddsDropSignal) => void) {}

  start(): void {
    if (this.stopRequested) return;
    setDropsPollActive(true);
    setPollRunning(true);
    void this.loop();
  }

  stop(): void {
    this.stopRequested = true;
    setPollRunning(false);
    this.abortController?.abort();
    this.abortController = null;
  }

  private buildUrl(): string {
    const base = trimBase(
      env.pinnacle.apiBase.trim() || 'https://pinnodds.com',
    );
    const q = new URLSearchParams();
    q.set(
      'mode',
      env.pinnacle.dropsMode.toLowerCase() === 'prematch' ? 'prematch' : 'live',
    );
    q.set('limit', String(env.pinnacle.dropsLimit));

    const minPct = env.pinnacle.dropsMinDropPct.trim();
    if (minPct) q.set('min_drop_pct', minPct);

    if (env.pinnacle.dropsMaxAgeSec > 0) {
      q.set('max_age_sec', String(env.pinnacle.dropsMaxAgeSec));
    }

    return `${base}/api/drops?${q.toString()}`;
  }

  private async loop(): Promise<void> {
    const interval = env.pinnacle.dropsPollMs;
    logger.info('[drops-poll] started', {
      intervalMs: interval,
      mode: env.pinnacle.dropsMode,
      hint: 'Trial tiers: widen PINNACLE_DROPS_POLL_MS if you hit 429 / daily caps.',
    });

    while (!this.stopRequested) {
      let nextSleep = interval;
      try {
        nextSleep = await this.tick();
      } catch (e) {
        logger.error('[drops-poll] unexpected tick error', {
          err: e instanceof Error ? e.message : String(e),
        });
        reportPollTick({ ok: false, dropCount: 0, err: 'unexpected' });
      }
      if (this.stopRequested) break;
      await delay(nextSleep);
    }

    setPollRunning(false);
    logger.info('[drops-poll] stopped');
  }

  /** @returns milliseconds to sleep before next poll */
  private async tick(): Promise<number> {
    const interval = env.pinnacle.dropsPollMs;
    const url = this.buildUrl();
    this.abortController = new AbortController();
    logger.debug('[drops-poll] fetching', { url });

    try {
      const res = await fetch(url, {
        headers: pinnacleJsonHeaders(),
        signal: this.abortController.signal,
      });

      if (res.status === 429) {
        const ra = res.headers.get('Retry-After');
        const raSec = ra ? Number(ra) : NaN;
        const extraMs =
          Number.isFinite(raSec) && raSec > 0 ? raSec * 1000 : 60_000;
        logger.warn('[drops-poll] rate limited (429)', {
          retryAfterSec: ra,
          waitingMs: Math.max(extraMs, interval),
        });
        reportPollTick({
          ok: false,
          dropCount: 0,
          err: `rate_limited_429_retry_after_${ra ?? '?'}`,
        });
        return Math.max(extraMs, interval + 30_000);
      }

      if (!res.ok) {
        const t = await res.text();
        logger.warn('[drops-poll] http error', { status: res.status, sample: t.slice(0, 200) });
        reportPollTick({
          ok: false,
          dropCount: 0,
          err: `http_${res.status}`,
        });
        return interval;
      }

      const json: unknown = await res.json();
      const drops = extractDropsArray(json);
      const receivedAt = Date.now();

      let newCount = 0;

      if (this.coldBoot) {
        logger.info('[drops-poll] cold boot — seeding dedupe cache, emitting none', {
          rows: drops.length,
        });
        for (const row of drops) {
          if (!row || typeof row !== 'object') continue;
          const r = row as Record<string, unknown>;
          this.deduper.remember(fingerprintDrop(r));
        }
        this.coldBoot = false;
        reportPollTick({ ok: true, dropCount: 0 });
        return interval;
      }

      for (const row of drops) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        const fp = fingerprintDrop(r);
        if (!this.deduper.firstTime(fp)) continue;
        const sig = normalizeApiDropToSignal(r, receivedAt);
        if (!sig) continue;
        newCount += 1;
        setImmediate(() => {
          try {
            this.onDrop(sig);
          } catch (e) {
            logger.error('[drops-poll] onDrop error', {
              err: e instanceof Error ? e.message : String(e),
            });
          }
        });
      }

      logger.info('[drops-poll] ok', { returned: drops.length, newDeduped: newCount });
      reportPollTick({ ok: true, dropCount: newCount });

      return interval;
    } catch (e) {
      if (this.stopRequested || (e instanceof Error && e.name === 'AbortError')) {
        return interval;
      }
      logger.warn('[drops-poll] fetch failed', {
        err: e instanceof Error ? e.message : String(e),
      });
      reportPollTick({
        ok: false,
        dropCount: 0,
        err: e instanceof Error ? e.message : String(e),
      });
      return interval;
    }
  }
}

function extractDropsArray(json: unknown): unknown[] {
  if (!json || typeof json !== 'object') return [];
  const o = json as Record<string, unknown>;
  const d = o.drops;
  return Array.isArray(d) ? d : [];
}
