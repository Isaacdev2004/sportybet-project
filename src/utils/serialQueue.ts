/**
 * Per-key serial execution — concurrent calls for distinct keys overlap;
 * concurrent calls for the same key queue in arrival order (mutex chain).
 */
const chains = new Map<string, Promise<unknown>>();

export function runSerial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = chains.get(key) ?? Promise.resolve();
  const done = next.then(fn, fn);
  chains.set(
    key,
    done.then(
      () => undefined,
      () => undefined,
    ),
  );
  return done;
}

/** Serialized Playwright execution per account **worker slot** (parallel tabs/contexts). */
export function runAccountWorkerExclusive<T>(
  accountId: string,
  workerSlot: number,
  fn: () => Promise<T>,
): Promise<T> {
  return runSerial(`sportybet:${accountId}:w${workerSlot}`, fn);
}

/** One global queue per account (legacy single worker). */
export function runAccountExclusive<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  return runAccountWorkerExclusive(accountId, 0, fn);
}
