import fs from 'node:fs';
import path from 'node:path';

import { executionEnv } from '../config/executionEnv.js';

const DEFAULT_PATH = path.join(process.cwd(), 'data', 'runtime_settings.json');

export interface RuntimeSettings {
  /** When true, execution does not skip identical line+selection within dedup TTL. */
  allowDuplicateBets: boolean;
}

let cache: RuntimeSettings = { allowDuplicateBets: false };

function resolvePath(): string {
  const raw = process.env.RUNTIME_SETTINGS_PATH?.trim();
  return raw ? path.resolve(process.cwd(), raw) : DEFAULT_PATH;
}

export function loadRuntimeSettings(): void {
  const file = resolvePath();
  try {
    if (!fs.existsSync(file)) {
      cache = { allowDuplicateBets: executionEnv.permissiveMode };
      return;
    }
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RuntimeSettings>;
    cache = {
      allowDuplicateBets: Boolean(j.allowDuplicateBets),
    };
  } catch {
    cache = { allowDuplicateBets: false };
  }
}

export function getRuntimeSettings(): Readonly<RuntimeSettings> {
  return cache;
}

export function updateRuntimeSettings(patch: Partial<RuntimeSettings>): RuntimeSettings {
  cache = { ...cache, ...patch };
  const file = resolvePath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
  return cache;
}
