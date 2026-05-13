import fs from 'node:fs';
import path from 'node:path';

import type { IndividualFilterRule } from '../filters/individualFilterTypes.js';
import type { BetDirectionFilter } from '../execution/types.js';

const DEFAULT_PATH = path.join(process.cwd(), 'data', 'individual_filters.json');

export interface IndividualFiltersFile {
  inplay: IndividualFilterRule[];
  prematch: IndividualFilterRule[];
  /**
   * For **total** and **team_total** scenarios only: allow both sides (default), over only, or under only.
   * Other markets (spread, moneyline, etc.) are unaffected.
   */
  gameTotalsSide: BetDirectionFilter;
}

/** Normalizes API / disk values for `gameTotalsSide`. */
export function normalizeGameTotalsSide(v: unknown): BetDirectionFilter {
  const s = String(v ?? 'both').trim().toLowerCase();
  if (s === 'over' || s === 'under') return s;
  return 'both';
}

const empty: IndividualFiltersFile = { inplay: [], prematch: [], gameTotalsSide: 'both' };

let cache: IndividualFiltersFile = { ...empty, inplay: [], prematch: [], gameTotalsSide: 'both' };
let lastMtimeMs = 0;

function resolvePath(): string {
  const raw = process.env.INDIVIDUAL_FILTERS_PATH?.trim();
  return raw ? path.resolve(process.cwd(), raw) : DEFAULT_PATH;
}

function normalizeRule(raw: unknown, fallbackOrder: number): IndividualFilterRule {
  const x = raw as Record<string, unknown>;
  const id = String(x.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  const order = typeof x.order === 'number' && Number.isFinite(x.order) ? x.order : fallbackOrder;
  const name = String(x.name ?? 'Unnamed').trim() || 'Unnamed';
  const sport = String(x.sport ?? '').trim().toLowerCase();
  const markets = Array.isArray(x.markets)
    ? (x.markets as string[])
        .map((m) => String(m).toLowerCase())
        .filter((m): m is IndividualFilterRule['markets'][number] =>
          ['moneyline', 'total', 'spread', 'team_total'].includes(m),
        )
    : [];
  const outcomes = Array.isArray(x.outcomes)
    ? (x.outcomes as string[])
        .map((o) => String(o).toLowerCase())
        .filter((o): o is IndividualFilterRule['outcomes'][number] =>
          ['home', 'away', 'draw', 'over', 'under'].includes(o),
        )
    : [];
  const minLine =
    typeof x.minLine === 'number' && Number.isFinite(x.minLine) ? x.minLine : undefined;
  const maxLine =
    typeof x.maxLine === 'number' && Number.isFinite(x.maxLine) ? x.maxLine : undefined;
  const periodNames = Array.isArray(x.periodNames)
    ? (x.periodNames as unknown[]).map((p) => String(p).trim().toLowerCase()).filter(Boolean)
    : [];

  return {
    id,
    order,
    name,
    sport,
    markets: [...new Set(markets)],
    outcomes: [...new Set(outcomes)],
    minLine,
    maxLine,
    periodNames,
  };
}

function readFromDisk(): IndividualFiltersFile {
  const file = resolvePath();
  try {
    if (!fs.existsSync(file)) {
      lastMtimeMs = 0;
      cache = { inplay: [], prematch: [], gameTotalsSide: 'both' };
      return cache;
    }
    const st = fs.statSync(file);
    if (st.mtimeMs === lastMtimeMs && cache) {
      return cache;
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<IndividualFiltersFile>;
    const inplay = Array.isArray(raw.inplay) ? raw.inplay.map((r, i) => normalizeRule(r, i)) : [];
    const prematch = Array.isArray(raw.prematch)
      ? raw.prematch.map((r, i) => normalizeRule(r, i))
      : [];
    const gameTotalsSide = normalizeGameTotalsSide(raw.gameTotalsSide);
    cache = { inplay, prematch, gameTotalsSide };
    lastMtimeMs = st.mtimeMs;
    return cache;
  } catch {
    cache = { inplay: [], prematch: [], gameTotalsSide: 'both' };
    lastMtimeMs = 0;
    return cache;
  }
}

/** Hot-reload when the JSON file changes (mtime). */
export function getIndividualFilters(): IndividualFiltersFile {
  return readFromDisk();
}

export function saveIndividualFilters(next: IndividualFiltersFile): IndividualFiltersFile {
  const file = resolvePath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const normalized: IndividualFiltersFile = {
    inplay: next.inplay.map((r, i) => normalizeRule(r, r.order ?? i)),
    prematch: next.prematch.map((r, i) => normalizeRule(r, r.order ?? i)),
    gameTotalsSide: normalizeGameTotalsSide(next.gameTotalsSide),
  };
  normalized.inplay.sort((a, b) => a.order - b.order);
  normalized.prematch.sort((a, b) => a.order - b.order);
  fs.writeFileSync(file, JSON.stringify(normalized, null, 2), 'utf8');
  lastMtimeMs = fs.statSync(file).mtimeMs;
  cache = normalized;
  return cache;
}

export function invalidateIndividualFiltersCache(): void {
  lastMtimeMs = 0;
}
