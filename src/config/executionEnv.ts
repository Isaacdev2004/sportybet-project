/**
 * Phase 2 execution — all flags from environment (no hardcoded secrets).
 */
import path from 'node:path';

function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function parseScenarioList(raw: string | undefined): string[] {
  if (!raw?.trim()) return ['total', 'spread', 'moneyline', 'team_total', 'other'];
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export const executionEnv = {
  enabled: envBool(process.env.EXECUTION_ENABLED),
  maxExecutionMs: Math.max(500, num(process.env.EXECUTION_MAX_MS, 2500)),
  dedupTtlMs: Math.max(60_000, num(process.env.EXECUTION_DEDUP_TTL_MS, 30 * 60_000)),
  maxOddsDrift: Math.max(0, num(process.env.EXECUTION_MAX_ODDS_DRIFT, 0.05)),
  headless: process.env.EXECUTION_HEADLESS !== 'false',
  /** Persist auth per account under this directory */
  sessionDir: process.env.EXECUTION_SESSION_DIR
    ? path.resolve(process.cwd(), process.env.EXECUTION_SESSION_DIR)
    : path.resolve(process.cwd(), 'data', 'sessions'),
  accountsFile: process.env.EXECUTION_ACCOUNTS_PATH
    ? path.resolve(process.cwd(), process.env.EXECUTION_ACCOUNTS_PATH)
    : path.resolve(process.cwd(), 'data', 'accounts.json'),
  /** SportyBet public site root — selection CSS live in navigationEngine / env overrides */
  sportyBetBaseUrl:
    process.env.EXECUTION_SPORTYBET_BASE_URL ?? 'https://www.sportybet.com',
  /** Site path after domain for keepalive pings (e.g. /ng/). */
  sportyBetHomePath:
    (process.env.EXECUTION_HOME_PATH ?? '/ng/').replace(/^([^/])/, '/$1'),
  /**
   * Background session keepalive interval per account (ms). 0 disables.
   * Uses `BrowserContext.request.get(home URL)` — same cookies, no extra tabs.
   */
  sessionKeepaliveMs: Math.max(0, num(process.env.EXECUTION_SESSION_KEEPALIVE_MS, 4 * 60_000)),
  /** Append-only JSONL file of every execution result (Phase 1 ledger). */
  ledgerPath: process.env.EXECUTION_LEDGER_PATH
    ? path.resolve(process.cwd(), process.env.EXECUTION_LEDGER_PATH)
    : path.resolve(process.cwd(), 'data', 'execution_ledger.jsonl'),

  globalMinEv: num(process.env.EXECUTION_GLOBAL_MIN_EV, 4),
  globalMaxEv: num(process.env.EXECUTION_GLOBAL_MAX_EV, 100),
  globalMinDropPct: num(process.env.EXECUTION_GLOBAL_MIN_DROP_PCT, 0),
  globalMaxDropPct: num(process.env.EXECUTION_GLOBAL_MAX_DROP_PCT, 100),
  globalMinNvp: num(process.env.EXECUTION_GLOBAL_MIN_NVP, 1),
  globalMaxNvp: num(process.env.EXECUTION_GLOBAL_MAX_NVP, 50),
  globalScenarios: parseScenarioList(process.env.EXECUTION_GLOBAL_SCENARIOS),
  /**
   * When true, every execution calls `goto(home)` (old behavior). Default false so the
   * shared session tab is not reloaded on every signal — allows manual login in headed mode.
   */
  forceHomeEachRun: envBool(process.env.EXECUTION_FORCE_HOME_EACH_RUN),
  /**
   * Playwright `page.goto` timeout when opening SportyBet (ms). Raise on slow networks.
   * @see EXECUTION_PAGE_GOTO_TIMEOUT_MS
   */
  pageGotoTimeoutMs: Math.max(5_000, num(process.env.EXECUTION_PAGE_GOTO_TIMEOUT_MS, 45_000)),
  /**
   * After waiting in the per-account Playwright queue, skip if the signal is older than this (ms).
   * 0 = off. Prevents 10+ minute queue stalls from still opening the browser on stale drops.
   */
  maxQueuedSignalAgeMs: Math.max(0, num(process.env.EXECUTION_MAX_QUEUED_SIGNAL_AGE_MS, 180_000)),
  /**
   * Parallel Playwright “workers” per account (each has its own BrowserContext + tab).
   * 1 = legacy single queue; 4 = up to four executions at once for the same account.
   * @see EXECUTION_ACCOUNT_WORKERS
   */
  accountWorkers: Math.max(1, Math.min(8, Math.floor(num(process.env.EXECUTION_ACCOUNT_WORKERS, 1)))),
  /**
   * When false (default), live-flow nav will NOT `goto(home)` if the URL is already the home path
   * but the sport link was not found (prevents infinite full-page reload loops with SPAs / selectors).
   * Set true only if you rely on hard reload to refresh the shell.
   */
  gotoHomeWhenSportLinkMissing: envBool(process.env.EXECUTION_GOTO_HOME_WHEN_SPORT_LINK_MISSING),
  /**
   * Optional absolute URLs — when set, live-flow skips “home → sport → Live” clicks and
   * navigates directly (e.g. Nigeria: /ng/sport/basketball/).
   */
  deepLinkBasketballUrl: (process.env.EXECUTION_DEEP_LINK_BASKETBALL_URL ?? '').trim(),
  deepLinkTennisUrl: (process.env.EXECUTION_DEEP_LINK_TENNIS_URL ?? '').trim(),
  deepLinkFootballUrl: (process.env.EXECUTION_DEEP_LINK_FOOTBALL_URL ?? '').trim(),
  /** Fallback when no sport-specific deep link matches (e.g. /ng/sport/live/). */
  deepLinkLiveUrl: (process.env.EXECUTION_DEEP_LINK_LIVE_URL ?? '').trim(),
  /**
   * After a deep link `goto`, try to click “Live” if that control is visible (sport vertical
   * pages often still need it). Set false for URLs that are already a full live list.
   */
  deepLinkTryLiveClick: process.env.EXECUTION_DEEP_LINK_TRY_LIVE_CLICK !== 'false',
};

/**
 * Single canonical “home” URL for SportyBet: merges `EXECUTION_SPORTYBET_BASE_URL` and
 * `EXECUTION_HOME_PATH` without duplicating path segments (e.g. base …/ng + path /ng → …/ng).
 */
export function sportyBetHomeUrl(): string {
  const base = executionEnv.sportyBetBaseUrl.trim().replace(/\/+$/, '');
  const segments = executionEnv.sportyBetHomePath.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return base;

  let result = base;
  for (const seg of segments) {
    const low = seg.toLowerCase();
    const rlow = result.toLowerCase();
    if (rlow.endsWith(`/${low}`)) continue;
    result = `${result}/${seg}`;
  }
  return result;
}

/**
 * Normalizes hostname for "same site" checks — treats `www.` as equivalent and compares
 * the last two labels (`sportybet.com`) so Playwright on `sportybet.com` matches env `www.sportybet.com`.
 */
export function registrableDomain(hostname: string): string {
  const h = hostname.toLowerCase();
  const noWww = h.startsWith('www.') ? h.slice(4) : h;
  const parts = noWww.split('.').filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join('.');
  return noWww;
}

/** Same SportyBet deployment (avoids endless `goto` when www vs non-www redirects). */
export function isSameSiteHostname(a: string, b: string): boolean {
  return registrableDomain(a) === registrableDomain(b);
}

/**
 * True when the browser is already showing the canonical home path (same pathname as `sportyBetHomeUrl()`).
 * Used to avoid `goto(home)` when it would only full-reload the same document in a loop.
 */
export function isAtSportyBetHomePath(pageUrl: string, homeUrl: string): boolean {
  try {
    const cur = new URL(pageUrl);
    const home = new URL(homeUrl);
    if (!isSameSiteHostname(cur.hostname, home.hostname)) return false;
    const norm = (pathname: string) => {
      const s = pathname.replace(/\/+$/, '') || '/';
      return s.toLowerCase();
    };
    return norm(cur.pathname) === norm(home.pathname);
  } catch {
    return false;
  }
}

/** Picks a configured deep-link URL for the live list flow (basketball / tennis / football / live hub). */
export function resolveSportyBetDeepListUrl(sportLabel: string, sportRaw?: string): string | undefined {
  const blob = `${sportRaw ?? ''} ${sportLabel}`.toLowerCase();
  if (blob.includes('basket') && executionEnv.deepLinkBasketballUrl) {
    return executionEnv.deepLinkBasketballUrl;
  }
  if (blob.includes('tennis') && executionEnv.deepLinkTennisUrl) {
    return executionEnv.deepLinkTennisUrl;
  }
  if ((blob.includes('foot') || blob.includes('soccer')) && executionEnv.deepLinkFootballUrl) {
    return executionEnv.deepLinkFootballUrl;
  }
  if (executionEnv.deepLinkLiveUrl) {
    return executionEnv.deepLinkLiveUrl;
  }
  return undefined;
}

/** True if we should load the canonical home URL (blank tab, wrong site, or forced). */
export function shouldNavigateToSportyBetHome(pageUrl: string, homeUrl: string, force: boolean): boolean {
  if (force) return true;
  if (!pageUrl || pageUrl === 'about:blank') return true;
  if (pageUrl.startsWith('chrome-error://')) return true;
  try {
    const home = new URL(homeUrl);
    const cur = new URL(pageUrl);
    if (!isSameSiteHostname(cur.hostname, home.hostname)) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}
