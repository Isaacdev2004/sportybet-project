import { env } from '../config/env.js';
import type { BettingOpportunity } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { withRetry, delay } from '../utils/helpers.js';
import { formatPhase1TelegramAlert } from './telegramAlertTemplate.js';

let telegramSendChain = Promise.resolve();

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

export async function sendTelegramPlain(text: string): Promise<void> {
  const token = env.telegram.botToken.trim();
  const chat = env.telegram.chatId.trim();
  if (!token || !chat) {
    logger.warn('[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing — skipping send');
    return;
  }

  const gap = env.telegram.minGapMs;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  let chatPayload: string | number = chat;
  if (/^-?\d+$/.test(chat)) {
    const n = Number(chat);
    if (Number.isSafeInteger(n)) chatPayload = n;
  }

  const exec = telegramSendChain
    .then(() => (gap > 0 ? delay(gap) : undefined))
    .then(() =>
      withRetry(
        'telegram_sendMessage',
        async () => {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatPayload,
              text,
              disable_web_page_preview: true,
            }),
          });
          if (!res.ok) {
            const t = await res.text();
            if (res.status === 404) {
              logger.error(
                '[telegram] HTTP 404 — invalid bot token (revoked/wrong) or chat_id. Use @BotFather for the token; message the bot /start first; @userinfobot for your numeric user id (groups use negative ids).',
              );
            }
            throw new Error(`telegram_${res.status}: ${t.slice(0, 200)}`);
          }
        },
        { maxRetries: 2 },
      ),
    );

  telegramSendChain = exec.catch(() => {});

  await exec;
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
    await sendTelegramPlain(body);
    logger.info('[telegram] alert sent', { ev: opportunity.evPercent });
  } catch (e) {
    logger.error('[telegram] send failed', {
      err: e instanceof Error ? e.message : String(e),
    });
  }
}
