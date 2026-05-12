/**
 * In-memory dedup with TTL (swap for Redis by implementing same interface later).
 */
export interface DedupBackend {
  has(key: string): boolean;
  set(key: string, ttlMs: number): void;
}

class InMemoryDedup implements DedupBackend {
  private readonly map = new Map<string, number>();

  has(key: string): boolean {
    const exp = this.map.get(key);
    if (!exp) return false;
    if (Date.now() > exp) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  set(key: string, ttlMs: number): void {
    this.map.set(key, Date.now() + ttlMs);
  }

  prune(): void {
    const now = Date.now();
    for (const [k, exp] of this.map) {
      if (now > exp) this.map.delete(k);
    }
  }
}

const globalDedup = new InMemoryDedup();

export function getDedupBackend(): DedupBackend {
  return globalDedup;
}

/** Canonical line for dedup — 150.5 and 150.50 match; 149.5 stays distinct from 150.5. */
export function normalizeDedupLine(line: string | number | undefined): string {
  if (line === undefined || line === '') return '';
  const raw = String(line).trim();
  const n = Number(raw);
  if (Number.isFinite(n)) return String(n);
  return raw.toLowerCase();
}

export function normalizeDedupDesignation(designation: string | undefined): string {
  return (designation ?? '').trim().toLowerCase();
}

/**
 * Execution dedup identity: same event + market + **line** + **selection** within TTL.
 * Example: Under 150.5 twice in 30m → skip; Under 150.5 vs Under 149.5 → both allowed.
 */
export function buildDedupKey(params: {
  parentId?: string;
  market?: string;
  sector?: string;
  line?: string | number;
  designation?: string;
}): string {
  const line = normalizeDedupLine(params.line);
  const designation = normalizeDedupDesignation(params.designation);
  const market = (params.market ?? '').trim().toLowerCase();
  const sector = (params.sector ?? '').trim().toLowerCase();
  return `${params.parentId ?? '?'}::${market}::${sector}::${line}::${designation}`;
}

export function shouldSkipDuplicate(
  backend: DedupBackend,
  key: string,
  ttlMs: number,
): boolean {
  if (backend.has(key)) return true;
  backend.set(key, ttlMs);
  return false;
}
