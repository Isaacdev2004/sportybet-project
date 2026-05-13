import type { Request, Response } from 'express';

import {
  getAccounts,
  saveAccountsToDisk,
} from '../account/accountManager.js';
import type {
  AccountFilters,
  BetDirectionFilter,
  ExecutionAccount,
  ScenarioFilter,
  StakeRange,
} from '../execution/types.js';
import { logger } from '../utils/logger.js';

const SCENARIOS: ScenarioFilter[] = ['total', 'spread', 'moneyline', 'team_total', 'other'];

function isDirection(v: string): v is BetDirectionFilter {
  return v === 'over' || v === 'under' || v === 'both';
}

function parseFilters(raw: unknown, existing?: AccountFilters): AccountFilters {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sports = Array.isArray(f.allowedSports)
    ? f.allowedSports.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
    : (existing?.allowedSports ?? []);
  const scenariosRaw = Array.isArray(f.scenarios) ? f.scenarios : (existing?.scenarios ?? []);
  const scenarios = scenariosRaw
    .map((s) => String(s).trim().toLowerCase())
    .filter((s): s is ScenarioFilter => SCENARIOS.includes(s as ScenarioFilter));
  const dir = String(f.direction ?? existing?.direction ?? 'both').toLowerCase();
  const direction: BetDirectionFilter = isDirection(dir) ? dir : 'both';
  const minEvRaw = f.minEvPercent;
  const minEvPercent =
    typeof minEvRaw === 'number' && Number.isFinite(minEvRaw)
      ? minEvRaw
      : typeof minEvRaw === 'string' && minEvRaw.trim() !== ''
        ? Number(minEvRaw)
        : existing?.minEvPercent;
  return {
    allowedSports: sports,
    scenarios: scenarios.length > 0 ? scenarios : (existing?.scenarios ?? ['total', 'spread']),
    direction,
    minEvPercent:
      typeof minEvPercent === 'number' && Number.isFinite(minEvPercent) ? minEvPercent : undefined,
  };
}

function parseStakeRanges(raw: unknown, existing: StakeRange[]): StakeRange[] {
  if (!Array.isArray(raw) || raw.length === 0) return existing;
  const out: StakeRange[] = [];
  for (const row of raw) {
    const o = row as Record<string, unknown>;
    const min = Number(o.min);
    const max = Number(o.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    if (min <= 0 || max <= 0) continue;
    out.push({ min: Math.min(min, max), max: Math.max(min, max) });
  }
  return out.length > 0 ? out : existing;
}

function normalizeOne(
  raw: unknown,
  byId: Map<string, ExecutionAccount>,
): ExecutionAccount {
  const x = raw as Record<string, unknown>;
  const id = String(x.id ?? '').trim();
  if (!id) throw new Error('Each account must have an id');
  const existing = byId.get(id);
  const username = String(x.username ?? existing?.username ?? '').trim();
  if (!username) throw new Error(`Account ${id}: username required`);
  const pwRaw = x.password;
  const password =
    typeof pwRaw === 'string' && pwRaw.trim().length > 0
      ? pwRaw
      : (existing?.password ?? '');
  if (!password) throw new Error(`Account ${id}: password required (or keep existing via omit empty)`);
  const stakeRanges = parseStakeRanges(x.stakeRanges, existing?.stakeRanges ?? [{ min: 100, max: 100 }]);
  const filters = parseFilters(x.filters, existing?.filters);
  const enabled = x.enabled === undefined ? existing?.enabled !== false : Boolean(x.enabled);
  const startingBalance =
    typeof x.startingBalance === 'number' && Number.isFinite(x.startingBalance)
      ? x.startingBalance
      : existing?.startingBalance;
  const proxy = typeof x.proxy === 'string' ? x.proxy.trim() || undefined : existing?.proxy;

  return {
    id,
    username,
    password,
    stakeRanges,
    filters,
    enabled,
    startingBalance,
    proxy,
  };
}

export function saveAccountsHandler(req: Request, res: Response): void {
  try {
    const body = req.body as { accounts?: unknown };
    if (!body || !Array.isArray(body.accounts)) {
      res.status(400).json({ ok: false, error: 'JSON body must be { "accounts": [ ... ] }' });
      return;
    }
    const byId = new Map(getAccounts().map((a) => [a.id, a]));
    const next: ExecutionAccount[] = [];
    for (const row of body.accounts) {
      next.push(normalizeOne(row, byId));
    }
    if (next.length === 0) {
      res.status(400).json({ ok: false, error: 'At least one account required' });
      return;
    }
    saveAccountsToDisk(next);
    logger.info('[accounts] saved from dashboard', { count: next.length });
    res.json({ ok: true, count: next.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('[accounts] save rejected', { err: msg });
    res.status(400).json({ ok: false, error: msg });
  }
}
