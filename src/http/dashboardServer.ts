import path from 'node:path';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getIngestSnapshot } from '../core/ingestStatus.js';
import type { PinnacleSseClient } from '../core/sseClient.js';
import type { RecentStore } from '../state/recentStore.js';
import {
  getExecutionLedgerHandler,
  getExecutionLogsHandler,
  getExecutionSettings,
} from '../dashboard/settingsController.js';
import { listAccounts, reloadAccounts } from '../dashboard/accountsController.js';

export function createDashboardApp(params: {
  sse: PinnacleSseClient;
  store: RecentStore;
  startedAtMs: number;
}): express.Express {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const publicDir = path.join(process.cwd(), 'public');

  app.use(express.static(publicDir));

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    /** Dashboard + execution page poll multiple endpoints; shared limiter counts all /api/* using this instance */
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.get('/health', (_req, res) => {
    const poll = getIngestSnapshot();
    const sseOk = env.pinnacle.useDropsPoll ? false : params.sse.connected;
    res.json({
      ok: true,
      uptimeSec: Math.floor((Date.now() - params.startedAtMs) / 1000),
      sseConnected: sseOk,
      ingest: poll,
      ts: new Date().toISOString(),
    });
  });

  app.get('/api/summary', apiLimiter, (_req, res) => {
    const poll = getIngestSnapshot();
    const sseOk = env.pinnacle.useDropsPoll ? false : params.sse.connected;
    res.json({
      sseConnected: sseOk,
      ingest: poll,
      snapshot: params.store.snapshot(),
    });
  });

  app.get('/api/execution/settings', apiLimiter, getExecutionSettings);
  app.get('/api/execution/logs', apiLimiter, getExecutionLogsHandler);
  app.get('/api/execution/ledger', apiLimiter, getExecutionLedgerHandler);
  app.get('/api/execution/accounts', apiLimiter, listAccounts);
  app.post('/api/execution/accounts/reload', apiLimiter, reloadAccounts);

  return app;
}

export function listenDashboard(
  app: express.Express,
): { close: () => Promise<void> } {
  const server = app.listen(env.server.port, env.server.host, () => {
    logger.info('[http] dashboard listening', {
      host: env.server.host,
      port: env.server.port,
    });
  });

  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
