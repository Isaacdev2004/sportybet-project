/**
 * Hard deadline guard — no retries after failure.
 */
export class ExecutionBudget {
  readonly startMs: number;
  readonly deadlineMs: number;

  constructor(maxMs: number) {
    this.startMs = Date.now();
    this.deadlineMs = this.startMs + maxMs;
  }

  remainingMs(): number {
    return Math.max(0, this.deadlineMs - Date.now());
  }

  isExceeded(): boolean {
    return Date.now() > this.deadlineMs;
  }

  assertWithin(): void {
    if (this.isExceeded()) {
      throw new ExecutionTimeExceededError();
    }
  }
}

export class ExecutionTimeExceededError extends Error {
  constructor() {
    super('execution_time_exceeded');
    this.name = 'ExecutionTimeExceededError';
  }
}
