import type { Page, Response } from 'playwright';

import { executionEnv, registrableDomain } from '../../../config/executionEnv.js';
import { appendSportyBetApiCatalog } from './catalog.js';

function isSportyBetHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    const base = executionEnv.sportyBetBaseUrl;
    const baseHost = new URL(base.startsWith('http') ? base : `https://${base}`).hostname;
    return registrableDomain(h) === registrableDomain(baseHost);
  } catch {
    return /sportybet/i.test(url);
  }
}

function looksLikeJsonResponse(res: Response): boolean {
  const ct = (res.headers()['content-type'] ?? '').toLowerCase();
  return ct.includes('json') || ct.includes('javascript');
}

/** Attach once per page — records JSON XHR/fetch to the RE catalog. */
export function attachSportyBetApiCapture(page: Page): void {
  if (!executionEnv.sportyBetApiCapture) return;

  page.on('response', (res) => {
    void (async () => {
      try {
        const url = res.url();
        if (!isSportyBetHost(url)) return;
        if (res.status() < 200 || res.status() >= 400) return;
        if (!looksLikeJsonResponse(res)) return;
        const txt = await res.text();
        const sample =
          txt.length > executionEnv.sportyBetApiCaptureSampleBytes
            ? txt.slice(0, executionEnv.sportyBetApiCaptureSampleBytes)
            : txt;
        appendSportyBetApiCatalog({
          ts: Date.now(),
          method: res.request().method(),
          url,
          status: res.status(),
          contentType: res.headers()['content-type'] ?? '',
          sample,
        });
      } catch {
        /* ignore capture errors */
      }
    })();
  });
}
