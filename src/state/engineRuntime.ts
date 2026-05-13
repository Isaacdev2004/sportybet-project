import { executionEnv } from '../config/executionEnv.js';

/** In-process pause — stops pipeline (alerts + execution). Clears on process restart. */
let paused = false;

export function isEnginePaused(): boolean {
  return paused;
}

export function setEnginePaused(value: boolean): void {
  paused = value;
}

export function getEngineControlState(): {
  paused: boolean;
  executionEnabledFromEnv: boolean;
  effectiveProcessing: boolean;
} {
  return {
    paused,
    executionEnabledFromEnv: executionEnv.enabled,
    effectiveProcessing: !paused,
  };
}
