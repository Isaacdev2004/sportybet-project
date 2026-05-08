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

export function buildDedupKey(params: {
  parentId?: string;
  market?: string;
  sector?: string;
  line?: string | number;
}): string {
  const line = params.line !== undefined ? String(params.line).trim() : '';
  return `${params.parentId ?? '?'}::${params.market ?? ''}::${params.sector ?? ''}::${line}`;
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
