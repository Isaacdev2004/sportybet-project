import 'dotenv/config';

import { env, validateRequiredAtRuntime } from './config/env.js';
import { logger } from './utils/logger.js';
import { PinnacleSseClient } from './core/sseClient.js';
import { PinnoddsDropsPoller } from './core/dropsPoller.js';
import { processOddsSignal } from './core/valuePipeline.js';
import { RecentStore } from './state/recentStore.js';
import { createDashboardApp, listenDashboard } from './http/dashboardServer.js';
import { shutdownBrowser } from './execution/playwrightManager.js';

const startedAtMs = Date.now();
const store = new RecentStore();

const missing = validateRequiredAtRuntime();
if (missing.length) {
  logger.warn('[boot] env issues', { missing });
}

let poller: PinnoddsDropsPoller | null = null;
const sse = new PinnacleSseClient((signal) => {
  void processOddsSignal(signal, store);
});

const dashboard = createDashboardApp({ sse, store, startedAtMs });
const { close } = listenDashboard(dashboard);

if (env.pinnacle.useDropsPoll) {
  poller = new PinnoddsDropsPoller((signal) => {
    void processOddsSignal(signal, store);
  });
  poller.start();
  logger.info('[boot] ingest mode=drops_poll (trial-friendly SSE alternative)');
} else {
  sse.start();
  logger.info('[boot] ingest mode=sse');
}

logger.info('[boot] pinnodds pricing', {
  preferFeedNvp: env.pinnacle.preferProviderNvp,
  detailsMaxConcurrent: env.pinnacle.detailsMaxConcurrent,
});
logger.info('[boot] telegram', {
  alertDedupeMs: env.telegram.dedupeWindowMs,
  minGapMs: env.telegram.minGapMs,
  maxQueueMs: env.telegram.maxQueueMs,
});

const dashboardBasicAuth =
  env.dashboard.username !== '' && env.dashboard.password !== '';
logger.info('[boot] dashboard', {
  basicAuth: dashboardBasicAuth,
  publicHealth: env.dashboard.publicHealth,
  host: env.server.host,
  port: env.server.port,
});

function gracefulShutdown(signal: string): void {
  logger.info('[boot] shutdown signal', { signal });
  poller?.stop();
  sse.stop();
  void Promise.all([
    shutdownBrowser().catch((e) =>
      logger.warn('[boot] playwright shutdown', {
        err: e instanceof Error ? e.message : String(e),
      }),
    ),
    close(),
  ]).finally(() => process.exit(0));
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('[process] unhandledRejection', {
    err: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on('uncaughtException', (err) => {
  logger.error('[process] uncaughtException', { err: err.message });
});
