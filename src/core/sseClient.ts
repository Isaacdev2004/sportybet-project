import EventSource from 'eventsource';

import type { OddsDropSignal } from '../types/index.js';
import {
  getPinnacleSseConnectOptions,
  pinnacleSseQueryAuthShape,
  redactPinnacleUrl,
  sseUrlLooksLikePlaceholder,
  env,
} from '../config/env.js';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/helpers.js';
import { extractDropPayloadExtras } from '../utils/dropPayloadExtras.js';
import { parseEventStartUnixFromPayload } from '../utils/eventStart.js';

let sseForbiddenPlanHinted = false;
let sseUnauthorizedHinted = false;
let sseTlsProtoHinted = false;

export type OddsDropHandler = (signal: OddsDropSignal) => void;

/** EventSource often passes a non-Error object; make logs actionable. */
function describeSseError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o.message === 'string') parts.push(o.message);
    if ('statusCode' in o) parts.push(`http=${String(o.statusCode)}`);
    if (typeof o.type === 'string') parts.push(`type=${o.type}`);
    if (typeof o.reason === 'string') parts.push(`reason=${o.reason}`);
    if (parts.length) return parts.join(' · ');
    try {
      return JSON.stringify(o);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  if (err == null) return 'no detail (check URL, TLS, firewall, VPN, token)';
  return String(err);
}

function sseReadyStateLabel(readyState: number): string {
  if (readyState === EventSource.CONNECTING) return 'CONNECTING';
  if (readyState === EventSource.OPEN) return 'OPEN';
  if (readyState === EventSource.CLOSED) return 'CLOSED';
  return String(readyState);
}

/** Extract canonical fields — tolerate multiple SSE provider JSON shapes (inc. PinnOdds).
 */
export function normalizeOddsDrop(
  raw: unknown,
  receivedAtMs: number,
): OddsDropSignal | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;

  const str = (keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
    return undefined;
  };

  const num = (keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
    }
    return undefined;
  };

  let parentId =
    str(['event_id', 'eventId', 'parent_id', 'parentId', 'parentID']) ?? undefined;
  if (!parentId && typeof o.id === 'number' && Number.isFinite(o.id)) {
    parentId = String(Math.trunc(o.id));
  }
  if (!parentId && typeof o.id === 'string' && /^\d+$/.test(o.id.trim())) {
    parentId = o.id.trim();
  }

  const periodRaw = num(['period']);
  const period =
    periodRaw !== undefined ? Math.trunc(periodRaw) : undefined;

  const periodName = str(['period_name', 'periodName', 'period_label', 'periodLabel']);

  const signal: OddsDropSignal = {
    raw,
    receivedAtMs,
    sport: str(['sport', 'sport_name', 'sportName']),
    league: str(['league', 'league_name', 'leagueName']),
    home: str(['home', 'home_team', 'homeTeam']),
    away: str(['away', 'away_team', 'awayTeam']),
    market: str(['market', 'market_name', 'marketName', 'type']),
    sector: str(['sect', 'sector', 'section']),
    line: (() => {
      const v = o.line ?? o.handicap ?? o.point ?? o.points;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim()) return v;
      return undefined;
    })(),
    designation: str(['designation', 'side', 'selection', 'name', 'outcome']),
    prevOdds: num([
      'prev_odds',
      'prevOdds',
      'previous_odds',
      'old_odds',
      'from_price',
      'from',
    ]),
    currentOdds: num([
      'current_odds',
      'currentOdds',
      'odds',
      'new_odds',
      'price',
      'to_price',
      'to',
    ]),
    parentId,
    period,
    periodName,
    isLive:
      typeof o.is_live === 'boolean'
        ? o.is_live
        : typeof o.isLive === 'boolean'
          ? o.isLive
          : undefined,
    providerNvp: (() => {
      const v = o.nvp ?? o.fair_nvp ?? o.fairNvp ?? o.true_odds;
      if (typeof v === 'number' && Number.isFinite(v) && v > 1) return v;
      if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n) && n > 1) return n;
      }
      return undefined;
    })(),
    eventStartUnixSec: parseEventStartUnixFromPayload(o),
    ...extractDropPayloadExtras(o),
  };

  // Require at least movement or parent id to treat as actionable
  if (!parentId && signal.prevOdds === undefined && signal.currentOdds === undefined) {
    return undefined;
  }
  return signal;
}

/**
 * Resilient SSE client with exponential backoff reconnect.
 * Runs entirely on the Node.js event loop (non-blocking handlers).
 */
export class PinnacleSseClient {
  private es: EventSource | null = null;
  private reconnectAttempt = 0;
  private closed = false;
  /** For logs (secrets redacted). */
  private lastSseSafeUrl = '';
  private lastSseAuthShape: { hasKey: boolean; hasToken: boolean } = {
    hasKey: false,
    hasToken: false,
  };

  constructor(private readonly onDrop: OddsDropHandler) {}

  start(): void {
    const opts = getPinnacleSseConnectOptions();
    if (!opts) {
      logger.error(
        '[sse] Missing PINNACLE_API_KEY (recommended) or a non-placeholder PINNACLE_SSE_URL — SSE not started',
      );
      return;
    }
    this.closed = false;
    this.open();
  }

  stop(): void {
    this.closed = true;
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  }

  /** True when the SSE socket is OPEN (drops can arrive). */
  get connected(): boolean {
    if (!this.es) return false;
    return this.es.readyState === EventSource.OPEN;
  }

  private open(): void {
    if (this.closed) return;

    const opts = getPinnacleSseConnectOptions();
    if (!opts) {
      logger.error('[sse] connect options unavailable — check env');
      return;
    }

    const { url, headers } = opts;
    this.lastSseSafeUrl = redactPinnacleUrl(url);
    this.lastSseAuthShape = pinnacleSseQueryAuthShape(url);

    if (sseUrlLooksLikePlaceholder(env.pinnacle.sseUrl.trim())) {
      logger.warn(
        '[sse] PINNACLE_SSE_URL is placeholder — using auto URL from PINNACLE_API_BASE + key',
      );
    }

    logger.info('[sse] connecting', {
      url: this.lastSseSafeUrl,
      sseAuth: this.lastSseAuthShape,
    });
    const es = new EventSource(url, { headers });

    es.onopen = () => {
      this.reconnectAttempt = 0;
      logger.info('[sse] open');
    };

    es.onmessage = (ev) => {
      const receivedAtMs = Date.now();
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data) as unknown;
      } catch {
        logger.debug('[sse] non-json frame', { sample: String(ev.data).slice(0, 160) });
        return;
      }

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const ctrl = parsed as Record<string, unknown>;
        if (ctrl.type === 'connected') {
          logger.debug('[sse] connected frame', { id: ctrl.id });
          return;
        }
        if (ctrl.type === 'error') {
          logger.warn('[sse] stream error frame', {
            error: ctrl.error,
            message: ctrl.message,
          });
          return;
        }
      }

      const batch = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of batch) {
        const signal = normalizeOddsDrop(item, receivedAtMs);
        if (!signal) continue;
        setImmediate(() => {
          try {
            this.onDrop(signal);
          } catch (e) {
            logger.error('[sse] onDrop error (swallowed)', {
              err: e instanceof Error ? e.message : String(e),
            });
          }
        });
      }
    };

    es.onerror = (err) => {
      const errMsg = describeSseError(err);
      logger.warn('[sse] error / disconnect', {
        err: errMsg,
        readyState: sseReadyStateLabel(es.readyState),
        url: this.lastSseSafeUrl,
      });
      if (
        !sseUnauthorizedHinted &&
        /\b401\b|unauthorized/i.test(errMsg)
      ) {
        sseUnauthorizedHinted = true;
        const noToken = !this.lastSseAuthShape.hasToken;
        logger.warn(
          noToken
            ? '[sse] Unauthorized: your request used key only — set PINNACLE_SSE_AUTH_TOKEN to the invite token from the odds-drop link (or use PINNACLE_SSE_URL?token=…&key=…). Also confirm PINNACLE_API_KEY is active for streaming.'
            : '[sse] Unauthorized: confirm both invite token and PINNACLE_API_KEY with PinnOdds; your plan may exclude odds-drop SSE — try PINNACLE_USE_DROPS_POLL=true.',
        );
      }
      if (
        !sseTlsProtoHinted &&
        /EPROTO|bad record mac|decryption failed/i.test(errMsg)
      ) {
        sseTlsProtoHinted = true;
        logger.warn(
          '[sse] TLS error (often EPROTO / bad record mac): VPNs, proxies, or antivirus HTTPS scanning can corrupt long-lived streams. Retry on a clean connection or disable HTTPS inspection.',
        );
      }
      if (!sseForbiddenPlanHinted && /forbidden|\b403\b/i.test(errMsg)) {
        sseForbiddenPlanHinted = true;
        logger.warn(
          '[sse] PinnOdds often returns 403 Forbidden when your plan does not include SSE (e.g. trial or Pro REST-only). Use a Stream / Pro+SSE / Scale key, poll GET /api/drops instead, or contact their support.',
        );
      }
      try {
        es.close();
      } catch {
        /* ignore */
      }
      this.es = null;
      void this.scheduleReconnect();
    };

    this.es = es;
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.closed) return;
    const attempt = this.reconnectAttempt++;
    const base = Math.min(30_000, 750 * 2 ** attempt);
    const wait = base + Math.floor(Math.random() * 500);
    logger.info('[sse] reconnect scheduled', { waitMs: wait, attempt });
    await delay(wait);
    this.open();
  }
}
