import fs from 'node:fs';

import type { ExecutionAccount } from '../execution/types.js';
import { executionEnv } from '../config/executionEnv.js';
import { normalizeStakeRanges } from '../stake/stakeManager.js';
import { logger } from '../utils/logger.js';

interface AccountsFileShape {
  accounts: ExecutionAccount[];
}

let cache: ExecutionAccount[] | null = null;
let lastMtimeMs = 0;

function readAccountsFromDisk(): ExecutionAccount[] {
  const file = executionEnv.accountsFile;
  try {
    if (!fs.existsSync(file)) {
      logger.warn('[accounts] accounts file missing', { file });
      return [];
    }
    const st = fs.statSync(file);
    if (cache && st.mtimeMs === lastMtimeMs) {
      return cache;
    }
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as AccountsFileShape | ExecutionAccount[];
    const list = Array.isArray(parsed) ? parsed : parsed.accounts;
    if (!Array.isArray(list)) {
      logger.error('[accounts] invalid JSON shape');
      return [];
    }
    cache = list
      .filter((a) => a.id)
      .map((a) => ({
        ...a,
        stakeRanges: normalizeStakeRanges(a.stakeRanges, a.id),
      }));
    lastMtimeMs = st.mtimeMs;
    return cache;
  } catch (e) {
    logger.error('[accounts] read failed', {
      err: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/** Hot-reload on each call (mtime memoized). */
export function getAccounts(): ExecutionAccount[] {
  return readAccountsFromDisk();
}

export function getAccountById(id: string): ExecutionAccount | undefined {
  return getAccounts().find((a) => a.id === id);
}

export function invalidateAccountsCache(): void {
  cache = null;
  lastMtimeMs = 0;
}
