import fs from 'node:fs';
import path from 'node:path';

import { executionEnv } from '../../../config/executionEnv.js';
import { logger } from '../../../utils/logger.js';

export interface SportyBetApiCatalogEntry {
  ts: number;
  method: string;
  url: string;
  status: number;
  contentType: string;
  /** Truncated JSON/text sample for offline RE. */
  sample?: string;
}

function catalogPath(): string {
  return executionEnv.sportyBetApiCatalogPath;
}

function ensureCatalogDir(filePath: string): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    /* ignore */
  }
}

export function appendSportyBetApiCatalog(entry: SportyBetApiCatalogEntry): void {
  const file = catalogPath();
  const line = `${JSON.stringify(entry)}\n`;
  try {
    ensureCatalogDir(file);
    fs.appendFileSync(file, line, 'utf8');
  } catch (e) {
    logger.debug('[sportybet-api] catalog append failed', {
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

export function readSportyBetApiCatalog(limit = 200): SportyBetApiCatalogEntry[] {
  const file = catalogPath();
  if (!fs.existsSync(file)) return [];
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
    const rows: SportyBetApiCatalogEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && rows.length < limit; i--) {
      try {
        rows.push(JSON.parse(lines[i]!) as SportyBetApiCatalogEntry);
      } catch {
        /* skip */
      }
    }
    return rows;
  } catch {
    return [];
  }
}
