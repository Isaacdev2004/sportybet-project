import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { RequestHandler } from 'express';
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
import {
  getDashboardBootstrap,
  getDashboardBets,
  getDashboardFeed,
  getDashboardFiltersView,
  getDashboardProxiesView,
  getDashboardStats,
  getDashboardStream,
  getDashboardControl,
  postDashboardControl,
  getDashboardActivity,
} from '../dashboard/dashboardController.js';
import {
  getIndividualFiltersHandler,
  putIndividualFiltersHandler,
} from '../dashboard/individualFiltersController.js';
import { saveAccountsHandler } from '../dashboard/accountsSaveController.js';

function timingSafeEqualStr(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** When DASHBOARD_USERNAME + DASHBOARD_PASSWORD are set, require HTTP Basic Auth. */
function createDashboardBasicAuth(): RequestHandler | undefined {
  const user = env.dashboard.username;
  const pass = env.dashboard.password;
  if (!user || pass === '') return undefined;

  return (req, res, next) => {
    if (env.dashboard.publicHealth && req.method === 'GET' && req.path === '/health') {
      return next();
    }

    const hdr = req.headers.authorization;
    if (!hdr?.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Dashboard"');
      res.status(401).send('Authentication required');
      return;
    }

    let decoded: string;
    try {
      decoded = Buffer.from(hdr.slice(6).trim(), 'base64').toString('utf8');
    } catch {
      res.setHeader('WWW-Authenticate', 'Basic realm="Dashboard"');
      res.status(401).send('Invalid credentials');
      return;
    }

    const colon = decoded.indexOf(':');
    const u = colon >= 0 ? decoded.slice(0, colon) : decoded;
    const p = colon >= 0 ? decoded.slice(colon + 1) : '';

    if (!timingSafeEqualStr(u, user) || !timingSafeEqualStr(p, pass)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Dashboard"');
      res.status(401).send('Invalid credentials');
      return;
    }

    next();
  };
}

export function createDashboardApp(params: {
  sse: PinnacleSseClient;
  store: RecentStore;
  startedAtMs: number;
}): express.Express {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const basicAuth = createDashboardBasicAuth();
  if (basicAuth) {
    app.use(basicAuth);
  }

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    /** Dashboard + execution page poll multiple endpoints; shared limiter counts all /api/* using this instance */
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * Register JSON routes **before** `express.static` so nothing under `public/` can shadow `/api/*`
   * and so a stale UI never “works” while the server is actually an old build without these handlers.
   */
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
  app.put('/api/execution/accounts', apiLimiter, saveAccountsHandler);

  const dashDeps = { sse: params.sse, store: params.store, startedAtMs: params.startedAtMs };
  app.get('/api/dashboard/bootstrap', apiLimiter, getDashboardBootstrap(dashDeps));
  app.get('/api/dashboard/activity', apiLimiter, getDashboardActivity(dashDeps));
  app.get('/api/dashboard/feed', apiLimiter, getDashboardFeed(dashDeps));
  app.get('/api/dashboard/control', apiLimiter, getDashboardControl());
  app.post('/api/dashboard/control', apiLimiter, postDashboardControl());
  app.get('/api/dashboard/individual-filters', apiLimiter, getIndividualFiltersHandler);
  app.put('/api/dashboard/individual-filters', apiLimiter, putIndividualFiltersHandler);
  app.get('/api/dashboard/stats', apiLimiter, getDashboardStats());
  app.get('/api/dashboard/bets', apiLimiter, getDashboardBets());
  app.get('/api/dashboard/filters', apiLimiter, getDashboardFiltersView());
  app.get('/api/dashboard/proxies', apiLimiter, getDashboardProxiesView());
  app.get('/api/dashboard/stream', getDashboardStream(dashDeps));

  const publicDir = path.join(process.cwd(), 'public');
  app.use(express.static(publicDir));

  /** Vite build output: `public/app/` — SPA fallback after `express.static` misses. */
  const reactIndex = path.join(publicDir, 'app', 'index.html');
  if (fs.existsSync(reactIndex)) {
    app.use('/app', (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      res.sendFile(reactIndex);
    });
  }

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
