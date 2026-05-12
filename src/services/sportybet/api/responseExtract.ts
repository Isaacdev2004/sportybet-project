import type { OddsDropSignal } from '../../../types/index.js';

function parseDecimal(v: unknown): number | undefined {
  if (typeof v === 'number' && v > 1 && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 1) return n;
  }
  return undefined;
}

/** Dot path: `data.markets.0.outcomes.1.odds` */
export function extractByDotPath(body: unknown, dotPath: string): unknown {
  if (!dotPath.trim()) return undefined;
  let cur: unknown = body;
  for (const seg of dotPath.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    const key = seg.trim();
    if (!key) continue;
    if (/^\d+$/.test(key)) {
      const idx = Number(key);
      cur = Array.isArray(cur) ? cur[idx] : undefined;
    } else {
      cur = (cur as Record<string, unknown>)[key];
    }
  }
  return cur;
}

export function extractDecimalOddsFromBody(
  body: unknown,
  side: 'over' | 'under',
  dotPath?: string,
  line?: string | number,
): number | undefined {
  if (dotPath?.trim()) {
    const v = extractByDotPath(body, dotPath.trim());
    const n = parseDecimal(v);
    if (n != null) return n;
  }

  const factsCenter = extractFactsCenterEventOdds(body, side, line);
  if (factsCenter != null) return factsCenter;

  if (!body || typeof body !== 'object') return undefined;
  const o = body as Record<string, unknown>;
  const keys =
    side === 'over'
      ? ['overOdds', 'over', 'homeOdds', 'oddsOver', 'price']
      : ['underOdds', 'under', 'awayOdds', 'oddsUnder', 'price'];
  for (const k of keys) {
    const n = parseDecimal(o[k]);
    if (n != null) return n;
  }
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        const n = extractDecimalOddsFromBody(item, side);
        if (n != null) return n;
      }
    } else if (v && typeof v === 'object') {
      const n = extractDecimalOddsFromBody(v, side);
      if (n != null) return n;
    }
  }
  return undefined;
}

/** `factsCenter/event` totals markets (`id` 18, `specifier` total=LINE). */
export function extractFactsCenterEventOdds(
  body: unknown,
  side: 'over' | 'under',
  line?: string | number,
): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const data = (body as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return undefined;
  const markets = (data as Record<string, unknown>).markets;
  if (!Array.isArray(markets)) return undefined;

  const lineStr = line !== undefined && line !== '' ? String(line).trim() : '';
  const wantSpec = lineStr ? `total=${lineStr}` : undefined;
  const sideNeedle = side === 'over' ? 'over' : 'under';

  const pickFromMarket = (market: Record<string, unknown>): number | undefined => {
    const outcomes = market.outcomes;
    if (!Array.isArray(outcomes)) return undefined;
    for (const outcome of outcomes) {
      if (!outcome || typeof outcome !== 'object') continue;
      const o = outcome as Record<string, unknown>;
      const desc = String(o.desc ?? '').toLowerCase();
      if (!desc.includes(sideNeedle)) continue;
      const n = parseDecimal(o.odds);
      if (n != null) return n;
    }
    return undefined;
  };

  if (wantSpec) {
    for (const market of markets) {
      if (!market || typeof market !== 'object') continue;
      const m = market as Record<string, unknown>;
      if (m.specifier !== wantSpec) continue;
      const n = pickFromMarket(m);
      if (n != null) return n;
    }
    return undefined;
  }

  for (const market of markets) {
    if (!market || typeof market !== 'object') continue;
    const m = market as Record<string, unknown>;
    const name = String(m.name ?? m.desc ?? '').toLowerCase();
    if (!name.includes('over/under') && m.id !== '18') continue;
    const n = pickFromMarket(m);
    if (n != null) return n;
  }
  return undefined;
}

/** Walk JSON for decimal odds near the Pinnacle anchor (RE fallback). */
export function extractOddsNearAnchor(
  body: unknown,
  anchor: number | undefined,
  tolerance = 0.35,
): number | undefined {
  if (anchor == null || !Number.isFinite(anchor) || anchor <= 1) return undefined;
  const lo = anchor * (1 - tolerance);
  const hi = anchor * (1 + tolerance);
  const found: number[] = [];

  const walk = (node: unknown, depth: number): void => {
    if (depth > 14 || node == null) return;
    if (typeof node === 'number' && node > 1 && node >= lo && node <= hi) {
      found.push(node);
      return;
    }
    if (typeof node === 'string') {
      const n = parseDecimal(node);
      if (n != null && n >= lo && n <= hi) found.push(n);
      return;
    }
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const v of Object.values(node as Record<string, unknown>)) {
        walk(v, depth + 1);
      }
    }
  };

  walk(body, 0);
  if (found.length === 0) return undefined;
  found.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor));
  return found[0];
}

export function pinnacleAnchorOdds(signal: OddsDropSignal): number | undefined {
  const cur = signal.currentOdds;
  if (typeof cur === 'number' && cur > 1) return cur;
  const prev = signal.prevOdds;
  if (typeof prev === 'number' && prev > 1) return prev;
  return undefined;
}
