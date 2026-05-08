import fs from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { env } from '../config/env.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Lightweight logger: stdout + append to daily log file under LOG_DIR.
 * Avoids crashing the pipeline if disk write fails (warns once).
 */
class Logger {
  private minLevel: number;
  private writeBroken = false;

  constructor() {
    const cfg = env.logging.level.toLowerCase() as LogLevel;
    this.minLevel = LEVEL_ORDER[cfg] ?? LEVEL_ORDER.info;
  }

  private should(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= this.minLevel;
  }

  private fmt(level: LogLevel, msg: string, meta?: unknown): string {
    const ts = new Date().toISOString();
    const base = `[${ts}] [${level.toUpperCase()}] ${msg}`;
    if (meta === undefined) return base;
    try {
      return `${base} ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
    } catch {
      return `${base} [unserializable-meta]`;
    }
  }

  private async appendFileSafe(line: string): Promise<void> {
    if (this.writeBroken) return;
    try {
      await fs.mkdir(env.logging.dir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const file = path.join(env.logging.dir, `app-${date}.log`);
      await fs.appendFile(file, `${line}\n`, 'utf8');
    } catch (e) {
      this.writeBroken = true;
      process.stderr.write(
        `[logger] file logging disabled: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  log(level: LogLevel, msg: string, meta?: unknown): void {
    if (!this.should(level)) return;
    const line = this.fmt(level, msg, meta);
    const stream: Writable =
      level === 'error' ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
    void this.appendFileSafe(line);
  }

  debug(msg: string, meta?: unknown): void {
    this.log('debug', msg, meta);
  }
  info(msg: string, meta?: unknown): void {
    this.log('info', msg, meta);
  }
  warn(msg: string, meta?: unknown): void {
    this.log('warn', msg, meta);
  }
  error(msg: string, meta?: unknown): void {
    this.log('error', msg, meta);
  }
}

export const logger = new Logger();
