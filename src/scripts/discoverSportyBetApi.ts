/**
 * SportyBet session — records JSON API calls to `data/sportybet_api_catalog.jsonl`
 * for reverse engineering odds/place-bet endpoints.
 *
 * Usage: SPORTYBET_API_CAPTURE=true npm run discover:sportybet-api
 *
 * On a VPS without a display, runs headless by default. For a virtual display:
 *   xvfb-run -a env SPORTYBET_API_CAPTURE=true npm run discover:sportybet-api
 */
import 'dotenv/config';

import { getAccounts } from '../account/accountManager.js';
import { executionEnv } from '../config/executionEnv.js';
import { ExecutionBudget } from '../risk/riskManager.js';
import { ensureLoggedInSportyBet } from '../execution/sessionManager.js';
import { goToLiveListPage } from '../execution/directSportyBetNav.js';
import { shutdownBrowser } from '../execution/playwrightManager.js';
import { readSportyBetApiCatalog } from '../services/sportybet/api/catalog.js';
import { resolveProveOrDiscoverHeadless } from '../utils/playwrightHeadless.js';
import { logger } from '../utils/logger.js';

async function main(): Promise<void> {
  if (!executionEnv.sportyBetApiCapture) {
    logger.warn('[discover] set SPORTYBET_API_CAPTURE=true to append to the API catalog');
  }

  const accounts = getAccounts().filter((a) => a.enabled !== false);
  if (accounts.length === 0) {
    throw new Error('No enabled accounts in accounts.json');
  }
  const account = accounts[0]!;
  const headless = resolveProveOrDiscoverHeadless('discover');
  const budget = new ExecutionBudget(120_000);

  logger.info('[discover] starting', { accountId: account.id, headless });

  try {
    const page = await ensureLoggedInSportyBet({
      account,
      headless,
      budget,
      workerSlot: executionEnv.sportyBetApiWorkerSlot,
    });

    const base = executionEnv.sportyBetBaseUrl.replace(/\/+$/, '');
    const verticals = [
      { label: 'Basketball', raw: 'basketball' },
      { label: 'Tennis', raw: 'tennis' },
      { label: 'Football', raw: 'football' },
    ];

    for (const v of verticals) {
      logger.info('[discover] navigating live list', { sport: v.label });
      await goToLiveListPage(page, base, v.label, budget, v.raw);
      await page.waitForTimeout(4_000);
    }

    const rows = readSportyBetApiCatalog(30);
    logger.info('[discover] catalog tail', {
      path: executionEnv.sportyBetApiCatalogPath,
      recent: rows.length,
      sampleUrls: rows.slice(0, 8).map((r) => r.url),
    });
    console.log(
      JSON.stringify(
        {
          catalogPath: executionEnv.sportyBetApiCatalogPath,
          recentEntries: rows.length,
          urls: rows.map((r) => ({ method: r.method, status: r.status, url: r.url })),
        },
        null,
        2,
      ),
    );
  } finally {
    await shutdownBrowser().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
