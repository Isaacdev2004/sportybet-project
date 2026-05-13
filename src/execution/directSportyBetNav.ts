/**
 * SportyBet — direct navigation only: Home → Sport → Live → scan rows → match detail → market → stake.
 * No search input, no booking code.
 */
import type { Locator, Page } from 'playwright';

import type { SportyBetMarketKey } from './types.js';
import type { ExecutionBudget } from '../risk/riskManager.js';
import { findMatchRowCached, preloadLiveMatchCache } from './matchDiscoveryCache.js';
import { logger } from '../utils/logger.js';
import {
  executionEnv,
  isAtSportyBetHomePath,
  isSameSiteHostname,
  resolveSportyBetDeepListUrl,
  sportyBetHomeUrl,
} from '../config/executionEnv.js';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function placeAttemptsFromEnv(): number {
  const raw = process.env.EXECUTION_PLACE_ATTEMPTS?.trim();
  if (!raw) return 3;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(6, Math.floor(n)));
}

export interface DirectNavOutcome {
  ok: boolean;
  skipReason?: 'match_not_found' | 'market_failed' | 'odds_drift_on_page' | 'nav_error';
}

/** Map feed sport string → SportyBet main nav link label (exact UI text). */
export function resolveSportLinkLabel(sportRaw: string): string {
  const s = sportRaw.toLowerCase();
  if (s.includes('basket')) {
    return process.env.EXECUTION_SPORT_LINK_BASKETBALL ?? 'Basketball';
  }
  if (s.includes('tennis')) {
    return process.env.EXECUTION_SPORT_LINK_TENNIS ?? 'Tennis';
  }
  if (s.includes('foot') || s.includes('soccer')) {
    return process.env.EXECUTION_SPORT_LINK_FOOTBALL ?? 'Football';
  }
  if (s.includes('hockey') || s.includes('ice hockey')) {
    return process.env.EXECUTION_SPORT_LINK_HOCKEY ?? 'Ice Hockey';
  }
  const t = sportRaw.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : 'Football';
}

async function readOddsFromPage(page: Page, budget: ExecutionBudget): Promise<number | undefined> {
  budget.assertWithin();
  const sel = process.env.EXECUTION_ODDS_DISPLAY ?? '.odd-value, .m-market-odd, [class*="odd"]';
  const el = await page.$(sel);
  if (!el) return undefined;
  const txt = await el.textContent();
  if (!txt) return undefined;
  const n = Number(txt.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 1 ? n : undefined;
}

async function isMainSportLinkVisible(
  page: Page,
  sportLabel: string,
  timeoutMs: number,
): Promise<boolean> {
  const sportFirst = page.getByRole('link', { name: sportLabel, exact: true }).first();
  if (await sportFirst.isVisible({ timeout: timeoutMs }).catch(() => false)) return true;
  return await page
    .getByRole('link', { name: new RegExp(`^${sportLabel}$`, 'i') })
    .first()
    .isVisible({ timeout: Math.min(1800, timeoutMs) })
    .catch(() => false);
}

async function maybeClickLiveTab(page: Page, budget: ExecutionBudget): Promise<void> {
  const liveName = process.env.EXECUTION_LIVE_LINK_NAME ?? 'Live';
  const live =
    (await page.getByRole('link', { name: liveName, exact: true }).count()) > 0
      ? page.getByRole('link', { name: liveName, exact: true }).first()
      : page.getByRole('button', { name: new RegExp(`^${liveName}$`, 'i') }).first();
  if (await live.isVisible({ timeout: 2000 }).catch(() => false)) {
    await live.click({ timeout: Math.min(10_000, budget.remainingMs()) }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
  }
  budget.assertWithin();
}

/**
 * Home (if needed) → Sport → Live — or optional deep-link URLs (EXECUTION_DEEP_LINK_*).
 */
export async function goToLiveListPage(
  page: Page,
  baseUrl: string,
  sportLabel: string,
  budget: ExecutionBudget,
  sportRaw?: string,
): Promise<boolean> {
  void baseUrl;
  budget.assertWithin();

  const deepUrl = resolveSportyBetDeepListUrl(sportLabel, sportRaw);
  if (deepUrl) {
    logger.info('[nav] deep-link entry', { url: deepUrl, sportLabel });
    await page.goto(deepUrl, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(executionEnv.pageGotoTimeoutMs, budget.remainingMs()),
    });
    budget.assertWithin();
    if (executionEnv.deepLinkTryLiveClick) {
      await maybeClickLiveTab(page, budget);
    }

    const rowSel =
      process.env.EXECUTION_LIVE_MATCH_ROW ??
      '[class*="Event"], [class*="event"], [data-testid*="event"], [data-testid*="match"], tr';
    const waitList = process.env.EXECUTION_LIVE_LIST_READY ?? rowSel;
    const maxRows = Number(process.env.EXECUTION_LIVE_SCAN_MAX_ROWS ?? '100');
    await preloadLiveMatchCache(page, sportLabel, budget, rowSel, waitList, maxRows);
    return true;
  }
  let onHome = await isMainSportLinkVisible(page, sportLabel, 2000);
  if (!onHome) {
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    if (executionEnv.navScrollSettleMs > 0) {
      await new Promise((r) => setTimeout(r, executionEnv.navScrollSettleMs));
    }
    onHome = await isMainSportLinkVisible(page, sportLabel, 2800);
  }

  if (!onHome) {
    const homeUrl = sportyBetHomeUrl();
    const atHomePath = isAtSportyBetHomePath(page.url(), homeUrl);
    if (atHomePath && !executionEnv.gotoHomeWhenSportLinkMissing) {
      logger.warn(
        '[nav] sport main link not found but URL is already SportyBet home — skipping goto (prevents reload loop)',
        {
          url: page.url(),
          sportLabel,
        },
      );
    } else {
      try {
        const cur = new URL(page.url());
        const home = new URL(homeUrl);
        if (isSameSiteHostname(cur.hostname, home.hostname)) {
          logger.info('[nav] sport nav not visible on SportyBet — loading home', {
            url: page.url(),
          });
        } else {
          logger.info('[nav] loading SportyBet home from off-site / blank', { url: page.url() });
        }
      } catch {
        /* log skipped */
      }

      await page.goto(homeUrl, {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(executionEnv.pageGotoTimeoutMs, budget.remainingMs()),
      });
      budget.assertWithin();
    }
  }

  const sport =
    (await page.getByRole('link', { name: sportLabel, exact: true }).count()) > 0
      ? page.getByRole('link', { name: sportLabel, exact: true }).first()
      : page.getByRole('link', { name: new RegExp(`^${sportLabel}$`, 'i') }).first();

  await sport.click({ timeout: Math.min(10_000, budget.remainingMs()) });
  budget.assertWithin();

  const liveName = process.env.EXECUTION_LIVE_LINK_NAME ?? 'Live';
  const live =
    (await page.getByRole('link', { name: liveName, exact: true }).count()) > 0
      ? page.getByRole('link', { name: liveName, exact: true }).first()
      : page.getByRole('button', { name: new RegExp(`^${liveName}$`, 'i') }).first();

  await live.click({ timeout: Math.min(10_000, budget.remainingMs()) });
  await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
  budget.assertWithin();

  const rowSel =
    process.env.EXECUTION_LIVE_MATCH_ROW ??
    '[class*="Event"], [class*="event"], [data-testid*="event"], [data-testid*="match"], tr';
  const waitList = process.env.EXECUTION_LIVE_LIST_READY ?? rowSel;
  const maxRows = Number(process.env.EXECUTION_LIVE_SCAN_MAX_ROWS ?? '100');
  await preloadLiveMatchCache(page, sportLabel, budget, rowSel, waitList, maxRows);

  return true;
}

/**
 * Scan Live list rows until team/player names match (normalized).
 * Uses findMatchRowCached: single batched textContent scan, TTL map, fuzzy fallback.
 */
export async function findMatch(
  page: Page,
  key: SportyBetMarketKey,
  budget: ExecutionBudget,
): Promise<Locator | null> {
  const rowSel =
    process.env.EXECUTION_LIVE_MATCH_ROW ??
    '[class*="Event"], [class*="event"], [data-testid*="event"], [data-testid*="match"], tr';
  const waitList = process.env.EXECUTION_LIVE_LIST_READY ?? rowSel;
  const maxRows = Number(process.env.EXECUTION_LIVE_SCAN_MAX_ROWS ?? '100');
  const sportLabel = resolveSportLinkLabel(key.sport);
  return findMatchRowCached(page, key, budget, rowSel, waitList, maxRows, sportLabel);
}

function sectorToTabPattern(key: SportyBetMarketKey): RegExp {
  const raw = `${key.sector ?? ''} ${key.designation ?? ''}`.toLowerCase();
  if (raw.includes('spread') || raw.includes('handicap')) {
    return new RegExp(process.env.EXECUTION_TAB_SPREAD ?? 'Handicap|Spread|Asian', 'i');
  }
  if (raw.includes('money') || raw.includes('winner') || raw.includes('match odds')) {
    return new RegExp(process.env.EXECUTION_TAB_MONEYLINE ?? 'Money|Winner|Match', 'i');
  }
  return new RegExp(process.env.EXECUTION_TAB_TOTALS ?? 'Total|Over/Under|O/U|Goals', 'i');
}

/**
 * Event page: open correct market tab, line, Over/Under (or side), verify on-page odds vs soft.
 */
export async function selectMarket(
  page: Page,
  key: SportyBetMarketKey,
  side: 'over' | 'under',
  softOdds: number,
  maxOddsDrift: number,
  budget: ExecutionBudget,
  skipOnPageOddsCompare: boolean,
): Promise<DirectNavOutcome> {
  budget.assertWithin();
  try {
    const pat = sectorToTabPattern(key);
    const tab =
      (await page.getByRole('tab', { name: pat }).count()) > 0
        ? page.getByRole('tab', { name: pat }).first()
        : page.getByRole('button', { name: pat }).first();
    await tab.click({ timeout: Math.min(6000, budget.remainingMs()) }).catch(() => {});
    budget.assertWithin();

    const lineStr = key.line !== undefined && key.line !== null ? String(key.line).trim() : '';
    if (lineStr) {
      const lineCell = page.getByText(lineStr, { exact: false }).first();
      await lineCell.scrollIntoViewIfNeeded().catch(() => {});
      await lineCell.click({ timeout: 4000 }).catch(() => {});
    }
    budget.assertWithin();

    const overText = process.env.EXECUTION_OUTCOME_OVER_LABEL ?? 'Over';
    const underText = process.env.EXECUTION_OUTCOME_UNDER_LABEL ?? 'Under';
    if (side === 'over') {
      await page
        .getByRole('button', { name: new RegExp(overText, 'i') })
        .first()
        .click({ timeout: 5000 })
        .catch(async () => {
          await page.getByText(new RegExp(`^${overText}$`, 'i')).first().click({ timeout: 3000 });
        });
    } else {
      await page
        .getByRole('button', { name: new RegExp(underText, 'i') })
        .first()
        .click({ timeout: 5000 })
        .catch(async () => {
          await page.getByText(new RegExp(`^${underText}$`, 'i')).first().click({ timeout: 3000 });
        });
    }
    budget.assertWithin();

    if (!skipOnPageOddsCompare) {
      const onPage = await readOddsFromPage(page, budget);
      if (onPage !== undefined && Math.abs(onPage - softOdds) > maxOddsDrift) {
        logger.warn('[nav] odds drift on page', { onPage, softOdds, maxOddsDrift });
        return { ok: false, skipReason: 'odds_drift_on_page' };
      }
    }

    return { ok: true };
  } catch (e) {
    logger.warn('[nav] selectMarket failed', {
      err: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, skipReason: 'market_failed' };
  }
}

/**
 * Fill stake field and confirm placement — waits for visible controls, retries transient SPA misses.
 * Tune selectors via env; set `EXECUTION_PLACE_ATTEMPTS` (1–6, default 3) for extra tries after failures.
 */
export async function placeBet(
  page: Page,
  stake: number,
  budget: ExecutionBudget,
): Promise<{ ok: boolean; reason?: string }> {
  const maxAttempts = placeAttemptsFromEnv();
  const stakeSel =
    process.env.EXECUTION_STAKE_INPUT ??
    'input[name="stake"], input[placeholder*="Stake"], input[placeholder*="stake"], input[placeholder*="min"]';
  const placeSel =
    process.env.EXECUTION_PLACE_BET ??
    'button:has-text("Place Bet"), button:has-text("Place"), button:has-text("Book"), [class*="place-bet"]';
  const confirmSel = process.env.EXECUTION_PLACE_CONFIRM_SELECTOR?.trim();
  const settleMs = executionEnv.placeBetSettleMs;

  if (stake > 0 && stake < 50) {
    logger.warn(
      '[nav] placeBet stake below NGN 50 — many books reject; raise stake min/max in accounts.json if placements fail',
      { stake },
    );
  }

  let lastReason = 'place_unknown';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    budget.assertWithin();
    try {
      const stakeWait = Math.min(14_000, Math.max(3500, budget.remainingMs()));
      const stakeLoc = page.locator(stakeSel).first();
      await stakeLoc.waitFor({ state: 'visible', timeout: stakeWait }).catch(() => {});
      if (!(await stakeLoc.isVisible().catch(() => false))) {
        lastReason = 'stake_input_not_found';
        logger.warn('[nav] placeBet stake input not visible', { attempt, maxAttempts, stakeSel });
        if (attempt < maxAttempts) {
          await delay(450 + attempt * 120);
          continue;
        }
        return { ok: false, reason: lastReason };
      }

      await stakeLoc.scrollIntoViewIfNeeded().catch(() => {});
      await stakeLoc.click({ timeout: Math.min(5000, budget.remainingMs()) }).catch(() => {});
      await stakeLoc.fill(String(stake), { timeout: Math.min(12_000, budget.remainingMs()) });
      budget.assertWithin();

      const placeWait = Math.min(14_000, Math.max(3500, budget.remainingMs()));
      const btnLoc = page.locator(placeSel).first();
      await btnLoc.waitFor({ state: 'visible', timeout: placeWait }).catch(() => {});
      if (!(await btnLoc.isVisible().catch(() => false))) {
        lastReason = 'place_button_not_found';
        logger.warn('[nav] placeBet place control not visible', { attempt, maxAttempts, placeSel });
        if (attempt < maxAttempts) {
          await delay(450 + attempt * 120);
          continue;
        }
        return { ok: false, reason: lastReason };
      }

      await btnLoc.scrollIntoViewIfNeeded().catch(() => {});
      await btnLoc.click({ timeout: Math.min(16_000, budget.remainingMs()) });
      if (settleMs > 0) {
        await delay(settleMs);
      }

      if (confirmSel) {
        const okSeen = await page
          .locator(confirmSel)
          .first()
          .isVisible({ timeout: 4000 })
          .catch(() => false);
        if (!okSeen) {
          lastReason = 'place_confirm_not_seen';
          logger.warn('[nav] placeBet post-click confirm selector not seen', { attempt, confirmSel });
          if (attempt < maxAttempts) {
            await delay(550);
            continue;
          }
          return { ok: false, reason: lastReason };
        }
      }

      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastReason = msg.length > 0 && msg.length < 160 ? msg : 'place_exception';
      logger.warn('[nav] placeBet attempt error', { attempt, maxAttempts, err: msg });
      if (attempt < maxAttempts) {
        await delay(400 + attempt * 150);
        continue;
      }
      return { ok: false, reason: lastReason };
    }
  }

  return { ok: false, reason: lastReason };
}

/** Orchestrates goToLiveListPage → findMatch → click → selectMarket. */
export async function navigateDirectLiveFlow(params: {
  page: Page;
  baseUrl: string;
  key: SportyBetMarketKey;
  side: 'over' | 'under';
  softOdds: number;
  maxOddsDrift: number;
  budget: ExecutionBudget;
  skipOnPageOddsCompare?: boolean;
}): Promise<DirectNavOutcome> {
  const {
    page,
    baseUrl,
    key,
    side,
    softOdds,
    maxOddsDrift,
    budget,
    skipOnPageOddsCompare = false,
  } = params;
  try {
    const label = resolveSportLinkLabel(key.sport);
    await goToLiveListPage(page, baseUrl, label, budget, key.sport);

    const row = await findMatch(page, key, budget);
    if (!row) {
      return { ok: false, skipReason: 'match_not_found' };
    }

    await row.click({ timeout: Math.min(8000, budget.remainingMs()) });
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    budget.assertWithin();

    return selectMarket(
      page,
      key,
      side,
      softOdds,
      maxOddsDrift,
      budget,
      skipOnPageOddsCompare,
    );
  } catch (e) {
    logger.warn('[nav] navigateDirectLiveFlow', {
      err: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, skipReason: 'nav_error' };
  }
}

/**
 * Navigate to the selection and read displayed decimal odds (no drift check vs expected).
 * Used for `SPORTYBET_LIVE_QUOTES` pipeline quotes.
 */
export async function probeSportyBetLiveOddsFromNav(params: {
  page: Page;
  baseUrl: string;
  key: SportyBetMarketKey;
  side: 'over' | 'under';
  budget: ExecutionBudget;
}): Promise<number | undefined> {
  const { page, baseUrl, key, side, budget } = params;
  const out = await navigateDirectLiveFlow({
    page,
    baseUrl,
    key,
    side,
    softOdds: 2,
    maxOddsDrift: 50,
    budget,
    skipOnPageOddsCompare: true,
  });
  if (!out.ok) {
    logger.info('[sportybet-live] nav incomplete', { reason: out.skipReason });
    return undefined;
  }
  return readOddsFromPage(page, budget);
}
