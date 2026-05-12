/**
 * Proves Playwright can log into SportyBet using data/accounts.json (or EXECUTION_ACCOUNTS_PATH).
 * This uses Playwright’s Chromium — not your everyday Chrome profile.
 *
 * Usage (from project root):
 *   npm run prove:login
 *
 * Optional env:
 *   EXECUTION_TEST_ACCOUNT_ID=main     — pick account id (default: first in file)
 *   EXECUTION_PROVE_HEADLESS=true      — force headless (default on Linux VPS without $DISPLAY)
 *   EXECUTION_PROVE_HEADED=true        — force visible window (needs X11 or xvfb-run)
 *   EXECUTION_PROVE_LOGIN_BUDGET_MS=120000
 *   EXECUTION_PROVE_LOGIN_PAUSE_SEC=30 — seconds before the window closes (default 30; not “forever”)
 *   EXECUTION_PROVE_LOGIN_WAIT_ENTER=true — keep browser open until you press Enter in this terminal (best for manual checks)
 *
 * Tune the same EXECUTION_*_SELECTOR vars as production (see sessionManager.ts).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { getAccounts } from '../account/accountManager.js';
import { ensureLoggedInSportyBet } from '../execution/sessionManager.js';
import { saveStorageState, shutdownBrowser } from '../execution/playwrightManager.js';
import { ExecutionBudget } from '../risk/riskManager.js';
import { resolveProveOrDiscoverHeadless } from '../utils/playwrightHeadless.js';
import { logger } from '../utils/logger.js';

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

async function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await new Promise<void>((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const accounts = getAccounts();
  const id = process.env.EXECUTION_TEST_ACCOUNT_ID?.trim();
  const account =
    (id ? accounts.find((a) => a.id === id) : undefined) ?? accounts[0];
  if (!account) {
    logger.error('[prove-login] no accounts found (check data/accounts.json or EXECUTION_ACCOUNTS_PATH)');
    process.exitCode = 1;
    return;
  }

  const headless = resolveProveOrDiscoverHeadless('prove-login');

  const budgetMs = num(process.env.EXECUTION_PROVE_LOGIN_BUDGET_MS, 120_000);
  const budget = new ExecutionBudget(budgetMs);

  logger.info('[prove-login] starting', {
    accountId: account.id,
    headless,
    budgetMs,
  });

  try {
    const page = await ensureLoggedInSportyBet({ account, headless, budget });

    const loggedInSelector =
      process.env.EXECUTION_LOGGED_IN_SELECTOR ??
      '[data-logged-in="true"], .user-balance, .m-balance';

    const marker = await page.$(loggedInSelector).catch(() => null);

    if (marker) {
      logger.info('[prove-login] PASS — logged-in marker visible', {
        selector: loggedInSelector,
      });
      try {
        await saveStorageState(account.id, page.context());
      } catch (e) {
        logger.warn('[prove-login] session save failed', {
          err: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      logger.warn('[prove-login] UNCLEAR — marker not found (page still opened)', {
        selector: loggedInSelector,
      });
    }

    const shotDir = path.join(process.cwd(), 'data', 'screenshots');
    fs.mkdirSync(shotDir, { recursive: true });
    const shotPath = path.join(shotDir, `prove-login-${account.id}.png`);
    try {
      await page.screenshot({
        path: shotPath,
        fullPage: false,
        timeout: 10_000,
        animations: 'disabled',
      });
      logger.info('[prove-login] screenshot saved', { screenshot: shotPath });
    } catch (e) {
      logger.warn('[prove-login] screenshot skipped', {
        screenshot: shotPath,
        err: e instanceof Error ? e.message : String(e),
      });
    }

    const waitEnter = envBool(process.env.EXECUTION_PROVE_LOGIN_WAIT_ENTER);
    const pauseSec = num(process.env.EXECUTION_PROVE_LOGIN_PAUSE_SEC, 30);
    if (!headless) {
      if (waitEnter && process.stdin.isTTY) {
        logger.info('[prove-login] browser stays open until you press Enter in this terminal');
        await waitForEnter('Press Enter to close the browser… ');
      } else if (waitEnter && !process.stdin.isTTY) {
        logger.warn(
          '[prove-login] EXECUTION_PROVE_LOGIN_WAIT_ENTER set but stdin is not a TTY — using pause timer instead',
        );
        if (pauseSec > 0) {
          logger.info('[prove-login] pause for manual inspection', { pauseSec });
          await new Promise((r) => setTimeout(r, pauseSec * 1000));
        }
      } else if (pauseSec > 0) {
        logger.info(
          '[prove-login] pause for manual inspection (window closes when timer ends — use EXECUTION_PROVE_LOGIN_WAIT_ENTER=true to wait for Enter instead)',
          { pauseSec },
        );
        await new Promise((r) => setTimeout(r, pauseSec * 1000));
      }
    }

    await page.close().catch(() => {});

    if (!marker) {
      process.exitCode = 1;
    }
  } finally {
    await shutdownBrowser().catch(() => {});
  }
}

void main().catch(async (e) => {
  logger.error('[prove-login] fatal', {
    err: e instanceof Error ? e.message : String(e),
  });
  process.exitCode = 1;
  await shutdownBrowser().catch(() => {});
});
