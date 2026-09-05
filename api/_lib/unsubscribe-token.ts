/**
 * Per-recipient unsubscribe links, signed so the endpoint cannot be used to
 * unsubscribe ANYONE-BUT-YOURSELF by guessing addresses.
 *
 * WHY THIS EXISTS (2026-09-05). Every brief email's footer linked
 * `https://nexuswatch.dev/#/unsubscribe` — a route that has NEVER existed in
 * the router. The unsubscribe link in every message a real subscriber
 * received was a 404. Compliance-wise that is the same as no link, with the
 * added insult that a reader who tried to leave couldn't.
 *
 * One email body is rendered per day for ALL recipients, so the link cannot
 * be baked in at render time. The renderer emits %%UNSUB_URL%% and
 * deliver-briefs substitutes per recipient at send time.
 *
 * Token = HMAC-SHA256(lowercased email, AUTH_SECRET), hex, truncated to 32
 * chars. Truncation keeps URLs short; 128 bits of an HMAC is far beyond
 * anything guessable, and the worst case of forgery is an unwanted
 * unsubscribe — annoying, reversible, and worth exactly this much ceremony.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const UNSUB_PLACEHOLDER = '%%UNSUB_URL%%';

function secret(): string | null {
  return process.env.AUTH_SECRET || process.env.CRON_SECRET || null;
}

export function unsubscribeToken(email: string): string | null {
  const s = secret();
  if (!s) return null;
  return createHmac('sha256', s).update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

export function unsubscribeUrl(email: string): string {
  const t = unsubscribeToken(email);
  // No secret configured → fall back to the settings page, which is a real
  // route. A degraded-but-real link beats a perfect link we cannot sign.
  if (!t) return 'https://nexuswatch.dev/settings';
  return `https://nexuswatch.dev/api/unsubscribe?e=${encodeURIComponent(email.trim().toLowerCase())}&t=${t}`;
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = unsubscribeToken(email);
  if (!expected || !token || token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

/** Substitute the placeholder for one recipient, in html or plain text. */
export function personalizeUnsubscribe(body: string, email: string): string {
  return body.split(UNSUB_PLACEHOLDER).join(unsubscribeUrl(email));
}
