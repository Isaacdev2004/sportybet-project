import type { Request, Response } from 'express';

import { buildDefaultExecutionSettings } from '../filters/filterEngine.js';
import { executionEnv } from '../config/executionEnv.js';
import { getEngineControlState } from '../state/engineRuntime.js';
import { getRuntimeSettings } from '../state/runtimeSettings.js';
import { getExecutionLogs } from '../state/executionLogStore.js';
import { readLedgerNewest } from '../state/betLedgerStore.js';

export function getExecutionSettings(_req: Request, res: Response): void {
  res.json({
    settings: buildDefaultExecutionSettings(),
    env: {
      enabled: executionEnv.enabled,
      maxExecutionMs: executionEnv.maxExecutionMs,
      dedupTtlMs: executionEnv.dedupTtlMs,
      headless: executionEnv.headless,
      sessionDir: executionEnv.sessionDir,
      accountsFile: executionEnv.accountsFile,
      sportyBetBaseUrl: executionEnv.sportyBetBaseUrl,
      sessionKeepaliveMs: executionEnv.sessionKeepaliveMs,
      ledgerPath: executionEnv.ledgerPath,
      deepLinks: {
        basketball: Boolean(executionEnv.deepLinkBasketballUrl),
        tennis: Boolean(executionEnv.deepLinkTennisUrl),
        football: Boolean(executionEnv.deepLinkFootballUrl),
        liveHub: Boolean(executionEnv.deepLinkLiveUrl),
        tryLiveClickAfterDeepLink: executionEnv.deepLinkTryLiveClick,
      },
      sportyBetLiveQuotes: executionEnv.sportyBetLiveQuotes,
      sportyBetLiveQuoteFallback: executionEnv.sportyBetLiveQuoteFallback,
      sportyBetLiveQuoteBudgetMs: executionEnv.sportyBetLiveQuoteBudgetMs,
      sportyBetLiveQuoteWorkerSlot: executionEnv.sportyBetLiveQuoteWorkerSlot,
      sportyBetOddsSource: executionEnv.sportyBetOddsSource,
      accountWorkers: executionEnv.accountWorkers,
      stakePickMidpoint: executionEnv.stakePickMidpoint,
      stakeRoundStep: executionEnv.stakeRoundStep,
      sportyBetApiOddsPaths: executionEnv.sportyBetApiOddsPaths,
      sportyBetApiCapture: executionEnv.sportyBetApiCapture,
      sportyBetApiCatalogPath: executionEnv.sportyBetApiCatalogPath,
      sportyBetApiHeuristicExtract: executionEnv.sportyBetApiHeuristicExtract,
      sportyBetApiConfigured: executionEnv.sportyBetApiOddsPaths.length > 0,
    },
    engine: {
      ...getEngineControlState(),
      allowDuplicateBets: getRuntimeSettings().allowDuplicateBets,
    },
  });
}

export function getExecutionLogsHandler(_req: Request, res: Response): void {
  res.json({ logs: getExecutionLogs() });
}

export function getExecutionLedgerHandler(req: Request, res: Response): void {
  const raw = req.query.limit;
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  const limit = Number.isFinite(n) ? Math.min(500, Math.max(1, Math.floor(n))) : 100;
  res.json({ rows: readLedgerNewest(limit) });
}
