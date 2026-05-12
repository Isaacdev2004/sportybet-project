import { executionEnv } from '../config/executionEnv.js';
import { logger } from './logger.js';

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function displayAvailable(): boolean {
  if (process.platform === 'win32' || process.platform === 'darwin') return true;
  return Boolean(process.env.DISPLAY?.trim());
}

/**
 * Headless on Linux servers without $DISPLAY unless the caller explicitly requests headed mode.
 */
export function resolvePlaywrightHeadlessForScript(opts: {
  /** Force visible browser (fails without X11 / xvfb). */
  forceHeaded?: boolean;
  /** Force headless even when a display exists. */
  forceHeadless?: boolean;
  /** When unset, uses `EXECUTION_HEADLESS` from env. */
  defaultHeadless?: boolean;
  logLabel?: string;
}): boolean {
  const label = opts.logLabel ?? 'playwright';

  if (opts.forceHeadless) {
    return true;
  }

  if (opts.forceHeaded) {
    if (!displayAvailable()) {
      logger.warn(`[${label}] headed mode requested but no $DISPLAY — using headless (try: xvfb-run -a npm run …)`);
      return true;
    }
    return false;
  }

  if (!displayAvailable() && process.platform === 'linux') {
    return true;
  }

  return opts.defaultHeadless ?? executionEnv.headless;
}

/** `prove:login` / `discover:sportybet-api` headless resolution from script-specific env flags. */
export function resolveProveOrDiscoverHeadless(script: 'prove-login' | 'discover'): boolean {
  const headedFlag =
    script === 'prove-login'
      ? envBool(process.env.EXECUTION_PROVE_HEADED)
      : envBool(process.env.EXECUTION_DISCOVER_HEADED);

  const headlessFlag =
    script === 'prove-login'
      ? process.env.EXECUTION_PROVE_HEADLESS === 'true'
      : process.env.EXECUTION_DISCOVER_HEADLESS === 'true';

  if (headlessFlag) {
    return true;
  }

  return resolvePlaywrightHeadlessForScript({
    forceHeaded: headedFlag,
    defaultHeadless: executionEnv.headless,
    logLabel: script,
  });
}
