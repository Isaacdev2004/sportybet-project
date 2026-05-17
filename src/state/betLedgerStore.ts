import fs from 'node:fs';
import path from 'node:path';

import type { BetExecutionResult } from '../execution/types.js';
import { executionEnv } from '../config/executionEnv.js';
import { logger } from '../utils/logger.js';

let writeTail = Promise.resolve();

type LedgerCache = { mtimeMs: number; size: number; rows: BetExecutionResult[] };
let ledgerCache: LedgerCache | null = null;

function invalidateLedgerCache(): void {
  ledgerCache = null;
}

function ensureLedgerDir(filePath: string): void {
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
}

/** Append JSON line atomically-ish (same-process serialized via writeTail). */
export function persistExecutionLedger(entry: BetExecutionResult): void {
  const filePath = executionEnv.ledgerPath;
  const line = `${JSON.stringify(entry)}\n`;
  writeTail = writeTail
    .then(
      async () => {
        ensureLedgerDir(filePath);
        await fs.promises.appendFile(filePath, line, 'utf8');
      },
      async () => {
        ensureLedgerDir(filePath);
        await fs.promises.appendFile(filePath, line, 'utf8');
      },
    )
    .catch((e: unknown) => {
      logger.error('[ledger] append failed', {
        err: e instanceof Error ? e.message : String(e),
      });
    });
  invalidateLedgerCache();
}

/** Read newest-first lines (parses trailing portion of file; cap bytes for large logs). */
export function readLedgerNewest(limit: number, maxReadBytes = 2_500_000): BetExecutionResult[] {
  const filePath = executionEnv.ledgerPath;
  if (!fs.existsSync(filePath)) return [];
  const st = fs.statSync(filePath);
  const sz = st.size;
  const start = Math.max(0, sz - maxReadBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const len = sz - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    const txt = buf.toString('utf8');
    /** If we sliced mid-file, drop first partial line */
    const lines = (start > 0 ? txt.split('\n').slice(1) : txt.split('\n')).filter((l) => l.trim());
    const rows: BetExecutionResult[] = [];
    for (let i = lines.length - 1; i >= 0 && rows.length < limit; i--) {
      try {
        rows.push(JSON.parse(lines[i]!) as BetExecutionResult);
      } catch {
        /* skip corrupt line */
      }
    }
    return rows;
  } finally {
    fs.closeSync(fd);
  }
}

/** Stats / Bets page — larger tail window (still bounded). */
export function readLedgerTailForDashboard(
  limit: number,
  maxReadBytes = 12_000_000,
): BetExecutionResult[] {
  const cap = Math.min(50_000, Math.max(1, Math.floor(limit)));
  const filePath = executionEnv.ledgerPath;
  if (!fs.existsSync(filePath)) return [];
  const st = fs.statSync(filePath);
  if (
    ledgerCache &&
    ledgerCache.mtimeMs === st.mtimeMs &&
    ledgerCache.size === st.size &&
    ledgerCache.rows.length >= cap
  ) {
    return ledgerCache.rows.slice(0, cap);
  }
  const rows = readLedgerNewest(cap, maxReadBytes);
  ledgerCache = { mtimeMs: st.mtimeMs, size: st.size, rows };
  return rows;
}
