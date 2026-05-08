import type { Page } from 'playwright';

import type { ExecutionAccount } from '../execution/types.js';
import {
  executionEnv,
  sportyBetHomeUrl,
  shouldNavigateToSportyBetHome,
} from '../config/executionEnv.js';
import { logger } from '../utils/logger.js';
import {
  getOrCreateContext,
  getOrCreateSessionPage,
  sessionKeyForWorker,
  saveStorageState,
  closeContext,
} from './playwrightManager.js';
import { parseProxy } from '../account/proxyManager.js';
import type { ExecutionBudget } from '../risk/riskManager.js';

/**
 * Ensures SportyBet session exists — **selectors are placeholders**; tune in production.
 */
const LOGIN = {
  username: process.env.EXECUTION_LOGIN_USER_SELECTOR ?? '[name="username"], input[type="text"]',
  password: process.env.EXECUTION_LOGIN_PASS_SELECTOR ?? '[name="password"], input[type="password"]',
  submit: process.env.EXECUTION_LOGIN_SUBMIT_SELECTOR ?? 'button[type="submit"]',
};

export async function ensureLoggedInSportyBet(params: {
  account: ExecutionAccount;
  headless: boolean;
  budget: ExecutionBudget;
  /** Parallel execution worker index (separate browser context per slot). Default 0. */
  workerSlot?: number;
}): Promise<Page> {
  const { account, headless, budget, workerSlot = 0 } = params;
  budget.assertWithin();

  const proxy = parseProxy(account.proxy);
  const sessionKey = sessionKeyForWorker(account.id, workerSlot);
  const ctx = await getOrCreateContext({
    accountId: account.id,
    workerSlot,
    proxy,
    headless,
  });

  let page: Page | undefined;
  let activeCtx = ctx;
  try {
    page = await getOrCreateSessionPage(sessionKey, ctx);
  } catch (e1) {
    logger.warn('[session] session page failed — recycling context', {
      accountId: account.id,
      workerSlot,
      err: e1 instanceof Error ? e1.message : String(e1),
    });
    await closeContext(account.id, workerSlot);
    const ctx2 = await getOrCreateContext({
      accountId: account.id,
      workerSlot,
      proxy,
      headless,
    });
    activeCtx = ctx2;
    page = await getOrCreateSessionPage(sessionKey, ctx2);
  }

  const home = sportyBetHomeUrl();
  const currentUrl = page.url();
  const didGotoHome = shouldNavigateToSportyBetHome(
    currentUrl,
    home,
    executionEnv.forceHomeEachRun,
  );

  if (didGotoHome) {
    await page.goto(home, {
      waitUntil: 'domcontentloaded',
      timeout: executionEnv.pageGotoTimeoutMs,
    });
  } else {
    logger.debug('[session] skip home navigation — already on SportyBet (no reload)', {
      accountId: account.id,
      workerSlot,
      currentUrl,
    });
  }
  budget.assertWithin();

  /** Minimal presence check — extend with real logged-in marker. */
  const loggedInMarker =
    process.env.EXECUTION_LOGGED_IN_SELECTOR ?? '[data-logged-in="true"], .user-balance, .m-balance';
  const already = await page.$(loggedInMarker).catch(() => null);
  if (!already) {
    if (didGotoHome) {
      try {
        await page.fill(LOGIN.username, account.username, { timeout: 8000 });
        await page.fill(LOGIN.password, account.password, { timeout: 8000 });
        await page.click(LOGIN.submit, { timeout: 8000 });
        await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
      } catch (e) {
        logger.warn('[session] login flow failed (selectors may need tuning)', {
          accountId: account.id,
          err: e instanceof Error ? e.message : String(e),
        });
      }
      await saveStorageState(account.id, activeCtx);
    } else {
      logger.info(
        '[session] not logged in yet — skipped auto-fill so you can sign in manually in this tab',
        { accountId: account.id },
      );
    }
  }

  budget.assertWithin();
  return page;
}
