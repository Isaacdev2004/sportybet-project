import { env } from '../config/env.js';
import type { BettingOpportunity } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/helpers.js';
import { formatPhase1TelegramAlert } from './telegramAlertTemplate.js';

let telegramSendChain = Promise.resolve();
let telegramQueueTailMs = Date.now();

/** Dedupe bursts: map fingerprint → last send time */
const telegramDedupeSeen = new Map<string, number>();
let telegramDedupePruneCounter = 0;

function alertFingerprint(o: BettingOpportunity): string {
  const s = o.signal;
  const market = `${s.market ?? ''}|${s.sector ?? ''}|${String(s.period ?? '')}|${String(s.line ?? '')}|${(s.designation ?? '').toLowerCase()}`;
  const evRounded = `${o.evPercent.toFixed(1)}`;
  return `${s.parentId ?? '?'}::${market}::${evRounded}`;
}

function pruneTelegramDedupe(now: number, windowMs: number): void {
  if (telegramDedupePruneCounter++ % 75 !== 0) return;
  const cutoff = now - Math.max(windowMs * 3, 60_000);
  for (const [k, t] of telegramDedupeSeen) {
    if (t < cutoff) telegramDedupeSeen.delete(k);
  }
}

export function formatTelegramMessage(o: BettingOpportunity): string {
  return formatPhase1TelegramAlert(o);
}

/** Telegram `sendMessage` 429 body includes `parameters.retry_after` (seconds). */
function telegram429WaitMs(body: string): number {
  try {
    const j = JSON.parse(body) as { parameters?: { retry_after?: number } };
    const sec = j.parameters?.retry_after;
    if (typeof sec === 'number' && Number.isFinite(sec) && sec > 0) {
      return Math.min(120_000, Math.ceil(sec * 1000) + 750);
    }
  } catch {
    /* ignore */
  }
  return 35_000;
}

async function postTelegramSendMessage(
  url: string,
  chatPayload: string | number,
  text: string,
): Promise<void> {
  let lastBody = '';
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatPayload,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (res.ok) return;

    lastStatus = res.status;
    lastBody = await res.text();

    if (res.status === 404) {
      logger.error(
        '[telegram] HTTP 404 — invalid bot token (revoked/wrong) or chat_id. Use @BotFather for the token; message the bot /start first; @userinfobot for your numeric user id (groups use negative ids).',
      );
      break;
    }

    if (res.status === 429 && attempt < 2) {
      const waitMs = telegram429WaitMs(lastBody);
      logger.warn('[telegram] rate limited (429) — waiting before retry', {
        waitMs,
        attempt: attempt + 1,
      });
      await delay(waitMs);
      continue;
    }

    break;
  }

  throw new Error(`telegram_${lastStatus}: ${lastBody.slice(0, 240)}`);
}

/** @returns true if the message was queued and sent successfully */
export async function sendTelegramPlain(text: string): Promise<boolean> {
  const token = env.telegram.botToken.trim();
  const chat = env.telegram.chatId.trim();
  if (!token || !chat) {
    logger.warn('[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing — skipping send');
    return false;
  }

  const gap = env.telegram.minGapMs;
  const maxQueueMs = env.telegram.maxQueueMs;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  let chatPayload: string | number = chat;
  if (/^-?\d+$/.test(chat)) {
    const n = Number(chat);
    if (Number.isSafeInteger(n)) chatPayload = n;
  }

  const now = Date.now();
  const projectedStart = Math.max(now, telegramQueueTailMs);
  const projectedEnd = projectedStart + gap;
  const backlogMs = projectedStart - now;
  if (maxQueueMs > 0 && backlogMs > maxQueueMs) {
    logger.warn('[telegram] dropping alert due to send backlog', {
      backlogMs,
      maxQueueMs,
      gapMs: gap,
    });
    return false;
  }
  telegramQueueTailMs = projectedEnd;

  const exec = telegramSendChain
    .then(() => (gap > 0 ? delay(gap) : undefined))
    .then(() => postTelegramSendMessage(url, chatPayload, text));

  telegramSendChain = exec.catch(() => {}).finally(() => {
    const t = Date.now();
    if (telegramQueueTailMs < t) telegramQueueTailMs = t;
  });

  await exec;
  return true;
}

export async function sendBettingAlert(opportunity: BettingOpportunity): Promise<void> {
  const win = env.telegram.dedupeWindowMs;
  if (win > 0) {
    const now = Date.now();
    const fp = alertFingerprint(opportunity);
    pruneTelegramDedupe(now, win);
    const last = telegramDedupeSeen.get(fp);
    if (last !== undefined && now - last < win) {
      logger.debug('[telegram] alert deduped', {
        fingerprint: fp.slice(0, 120),
        agoMs: now - last,
      });
      return;
    }
    telegramDedupeSeen.set(fp, now);
  }

  const body = formatTelegramMessage(opportunity);
  try {
    const sent = await sendTelegramPlain(body);
    if (sent) {
      logger.info('[telegram] alert sent', { ev: opportunity.evPercent });
    }
  } catch (e) {
    logger.error('[telegram] send failed', {
      err: e instanceof Error ? e.message : String(e),
    });
  }
}
