import type { ProxySettings } from './types.js';

/**
 * Parse `host:port:user:pass` or `host:port` for Playwright proxy.server / credentials.
 */
export function parseProxy(proxyRaw: string | undefined): ProxySettings | undefined {
  if (!proxyRaw?.trim()) return undefined;
  const s = proxyRaw.trim();
  const parts = s.split(':');
  if (parts.length < 2) return undefined;
  const host = parts[0]!;
  const port = parts[1]!;
  if (parts.length >= 4) {
    return {
      server: `http://${host}:${port}`,
      username: decodeURIComponent(parts[2]!),
      password: decodeURIComponent(parts.slice(3).join(':')),
    };
  }
  return { server: `http://${host}:${port}` };
}
