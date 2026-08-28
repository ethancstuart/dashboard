import { timingSafeEqual } from 'node:crypto';

/**
 * Shared cron utilities.
 *
 * Vercel cron schedules don't support random jitter, so we add it
 * inside the handler. This prevents thundering-herd when multiple
 * crons fire at the top of the minute and all try to hit the same
 * upstream APIs simultaneously.
 *
 * Typical usage:
 *   export default async function handler(req, res) {
 *     await cronJitter(30); // wait 0-30s before proceeding
 *     ...
 *   }
 */

/**
 * Sleep for a random time between 0 and maxSeconds.
 * Use at the top of cron handlers to stagger execution.
 */
export function cronJitter(maxSeconds = 30): Promise<void> {
  const ms = Math.floor(Math.random() * maxSeconds * 1000);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The one cron authorization check. FAIL-CLOSED, by construction.
 *
 * WHY THIS EXISTS. An audit on 2026-08-28 found 53 cron handlers using four
 * different authorization idioms — and two of them PASS when CRON_SECRET is
 * unset, because `token !== process.env.CRON_SECRET` compares undefined to
 * undefined. Nine of ten marketing handlers had no check at all while
 * MARKETING_AUTOMATION_ENABLED was verified `'true'` in production, so an
 * unauthenticated request to /api/cron/marketing-x reached a paid Claude
 * generation and a paid voice evaluation.
 *
 * Three properties this has and the old idioms did not:
 *  - A MISSING secret refuses everything. An unconfigured deployment is not an
 *    open one.
 *  - The Authorization header only. The old form also accepted `?token=`,
 *    which puts the secret in Vercel access logs and in Referer headers.
 *  - Constant-time comparison, so the check cannot be probed byte by byte.
 *
 * Usage — the FIRST statement of the handler, before any I/O:
 *   if (!requireCron(req, res)) return;
 */
export function requireCron(
  req: { headers: Record<string, unknown> },
  res: { status: (n: number) => { json: (b: unknown) => unknown } },
): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed. Never treat "not configured" as "allowed".
    console.error('[cron-auth] CRON_SECRET is unset — refusing the request');
    res.status(500).json({ error: 'cron_secret_not_configured' });
    return false;
  }
  const header = req.headers['authorization'];
  const provided = typeof header === 'string' ? header.replace(/^Bearer /, '') : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  // timingSafeEqual throws on a length mismatch, so compare lengths first —
  // the length is not the secret.
  let ok = a.length === b.length;
  if (ok) ok = timingSafeEqual(a, b);
  if (!ok) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}
