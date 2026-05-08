/**
 * Fuzzy participant matching for SportyBet rows (teams or tennis players).
 * Avoids exact string equality: case, punctuation, and short forms (e.g. "Djokovic N.").
 */

/** Lowercase, strip diacritics & punctuation, collapse spaces */
export function normalizeName(s: string): string {
  if (!s?.trim()) return '';
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(sig: string): string[] {
  return normalizeName(sig)
    .split(' ')
    .filter((t) => t.length > 0);
}

/**
 * One participant from the signal matches text in the row ( substring, surname, or token overlap ).
 */
export function participantMatchesSignal(signalName: string, rowBlob: string): boolean {
  const blob = normalizeName(rowBlob);
  const sig = normalizeName(signalName);
  if (!sig) return true;
  if (blob.includes(sig)) return true;

  const tks = tokens(signalName).filter((t) => t.length >= 2);
  if (tks.length === 0) return false;

  const last = tks[tks.length - 1]!;
  if (last.length >= 4 && blob.includes(last)) return true;

  let hits = 0;
  for (const t of tks) {
    if (t.length >= 4 && blob.includes(t)) {
      hits++;
      continue;
    }
    if (t.length >= 3) {
      const re = new RegExp(`\\b${escapeRe(t)}\\b`, 'i');
      if (re.test(blob)) hits++;
    }
  }

  const need = tks.length >= 2 ? Math.min(2, tks.length) : 1;
  return hits >= need;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Stable lookup key for two participants (order-independent). */
export function canonicalPairKey(home: string, away: string): string {
  const a = normalizeName(home);
  const b = normalizeName(away);
  return [a, b].sort((x, y) => x.localeCompare(y)).join('::');
}

/**
 * Secondary lookup: both names sorted and joined (order-independent "teamA teamB" style).
 */
export function secondaryPairJoinKey(home: string, away: string): string {
  const a = normalizeName(home);
  const b = normalizeName(away);
  return `join:${[a, b].sort((x, y) => x.localeCompare(y)).join(' ')}`;
}

/** Row text matches both home and away (order-independent). */
export function rowMatchesParticipants(
  home: string,
  away: string,
  rowText: string,
): boolean {
  if (!normalizeName(rowText)) return false;
  return participantMatchesSignal(home, rowText) && participantMatchesSignal(away, rowText);
}
