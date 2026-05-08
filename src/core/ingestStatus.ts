/** Shared snapshot for `/health` and `/api/summary` (SSE vs drops polling). */

export interface IngestStatusSnapshot {
  dropsPollActive: boolean;
  lastPollOk: boolean | null;
  lastPollAtIso: string | null;
  lastPollDropCount: number;
  lastPollError: string | null;
}

const state: IngestStatusSnapshot & { running: boolean } = {
  dropsPollActive: false,
  running: false,
  lastPollOk: null,
  lastPollAtIso: null,
  lastPollDropCount: 0,
  lastPollError: null,
};

export function setDropsPollActive(active: boolean): void {
  state.dropsPollActive = active;
}

export function setPollRunning(running: boolean): void {
  state.running = running;
}

export function reportPollTick(params: {
  ok: boolean;
  dropCount: number;
  err?: string;
}): void {
  state.lastPollOk = params.ok;
  state.lastPollAtIso = new Date().toISOString();
  state.lastPollDropCount = params.dropCount;
  state.lastPollError = params.ok ? null : params.err ?? 'unknown_error';
}

export function getIngestSnapshot(): IngestStatusSnapshot & { pollLoopRunning: boolean } {
  return {
    dropsPollActive: state.dropsPollActive,
    pollLoopRunning: state.running,
    lastPollOk: state.lastPollOk,
    lastPollAtIso: state.lastPollAtIso,
    lastPollDropCount: state.lastPollDropCount,
    lastPollError: state.lastPollError,
  };
}
