import type { BetExecutionResult } from '../execution/types.js';
import { persistExecutionLedger } from './betLedgerStore.js';

const MAX = 200;
const ring: BetExecutionResult[] = [];

export function appendExecutionLog(entry: BetExecutionResult): void {
  ring.unshift(entry);
  while (ring.length > MAX) ring.pop();
  persistExecutionLedger(entry);
}

export function getExecutionLogs(): BetExecutionResult[] {
  return ring.slice();
}
