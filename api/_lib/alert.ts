/**
 * The alarm bell — one place, and it reaches a person with what is already
 * configured.
 *
 * WHY THIS EXISTS. Every monitoring component in this repo posted to
 * `DISCORD_APPROVAL_WEBHOOK_URL`, and that variable has never been set in
 * production — verified 2026-08-28 against `vercel env ls`. So `cron-health`
 * silently no-opped, and the outcome was exactly what this project's own
 * governance predicts: a delivery channel failed for 41 consecutive days,
 * writing a `failed` row every single morning, and nobody found out until a
 * human ran a query by hand.
 *
 * A check whose result does not reach a person is a log line. So the alarm no
 * longer depends on a channel that was never wired: it prefers Discord when a
 * webhook exists, and otherwise sends email through Resend to ADMIN_EMAILS —
 * both of which ARE configured in production today. Nothing to set up, which
 * is the point; a monitoring plan gated on a five-minute task nobody does is
 * a monitoring plan that does not exist.
 *
 * It returns which channel carried the alert so callers can report honestly
 * rather than assume delivery.
 */

export type AlertChannel = 'discord' | 'email' | 'none' | 'suppressed';

export interface AlertResult {
  delivered: boolean;
  channel: AlertChannel;
  detail: string;
}

export interface AlertInput {
  /** Short, specific. Becomes the Discord heading and the email subject. */
  title: string;
  /** Plain text. Keep it readable in a phone notification. */
  body: string;
  severity?: 'critical' | 'warning';
  /**
   * STABLE identity of the condition — e.g. the sorted set of affected
   * endpoints. Two raises with the same key are the same ongoing problem, and
   * only the first one notifies until the reminder interval elapses.
   *
   * Deliberately supplied by the caller rather than hashed from the body:
   * bodies carry live numbers ("3934ms") that change on every run, so hashing
   * them would defeat deduplication silently and send the flood anyway.
   *
   * Omit it and the alert always sends — appropriate for genuinely one-off
   * events, wrong for anything a cron evaluates repeatedly.
   */
  key?: string;
}

/**
 * How long a CONTINUING condition stays quiet between reminders.
 *
 * Not silence: a problem that is still happening six hours later is worth
 * saying again, because the first notification may have arrived at 3am. But
 * every thirty minutes is not a reminder, it is noise — and on 2026-08-28 that
 * is exactly what happened: nine identical [CRITICAL] emails for one
 * continuous /api/cii timeout.
 */
export const ALERT_REMINDER_HOURS = 6;

async function viaDiscord(webhook: string, a: AlertInput): Promise<AlertResult> {
  const emoji = a.severity === 'critical' ? '🔴' : '🟡';
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `${emoji} **${a.title}**\n${a.body}`.slice(0, 1900), username: 'NexusWatch' }),
    signal: AbortSignal.timeout(8000),
  });
  return res.ok
    ? { delivered: true, channel: 'discord', detail: 'posted' }
    : { delivered: false, channel: 'discord', detail: `discord_${res.status}` };
}

async function viaEmail(key: string, to: string[], a: AlertInput): Promise<AlertResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'NexusWatch Alerts <brief@nexuswatch.dev>',
      to,
      subject: `[${a.severity === 'critical' ? 'CRITICAL' : 'WARNING'}] ${a.title}`,
      text: a.body,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (res.ok) return { delivered: true, channel: 'email', detail: `sent to ${to.length} address(es)` };
  const detail = await res.text().catch(() => '');
  return { delivered: false, channel: 'email', detail: `resend_${res.status}: ${detail.slice(0, 120)}` };
}

/**
 * Should this condition notify a person right now?
 *
 * FAILS OPEN, and that direction is deliberate: if the state table is
 * unreachable we send. A duplicate email is an annoyance; a swallowed alert is
 * the failure this whole module exists to end. Never let the deduplicator
 * become a new way to hear nothing.
 */
/**
 * The deduplication rule, as a pure function so it can be tested.
 *
 * Kept in TypeScript rather than in the SQL CASE it replaced: a rule expressed
 * in a query is a rule nothing can unit-test, and this one decides whether a
 * person hears about an outage.
 */
export function isNotificationDue(
  lastSent: Date | null,
  now: Date = new Date(),
  reminderHours: number = ALERT_REMINDER_HOURS,
): boolean {
  if (!lastSent) return true; // never told anyone
  const elapsedHours = (now.getTime() - lastSent.getTime()) / 3_600_000;
  return elapsedHours >= reminderHours;
}

/** Whole hours a condition has been going on, for the reminder wording. */
export function ongoingHoursSince(firstSeen: Date | null, now: Date = new Date()): number {
  if (!firstSeen) return 0;
  return Math.max(0, Math.floor((now.getTime() - firstSeen.getTime()) / 3_600_000));
}

/**
 * Should this condition notify a person right now?
 *
 * FAILS OPEN, and that direction is deliberate: if the state table is
 * unreachable we send. A duplicate email is an annoyance; a swallowed alert is
 * the failure this whole module exists to end. The deduplicator must never
 * become a new way to hear nothing.
 */
async function shouldNotify(key: string, a: AlertInput): Promise<{ send: boolean; ongoingHours: number }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return { send: true, ongoingHours: 0 };
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(dbUrl);
    const rows = (await sql`
      INSERT INTO alert_state (fingerprint, title, severity, first_seen, last_seen)
      VALUES (${key}, ${a.title}, ${a.severity ?? 'warning'}, NOW(), NOW())
      ON CONFLICT (fingerprint) DO UPDATE
        SET last_seen = NOW(), title = EXCLUDED.title, severity = EXCLUDED.severity
      RETURNING last_sent, first_seen
    `) as unknown as Array<{ last_sent: string | null; first_seen: string }>;
    const row = rows[0];
    const lastSent = row?.last_sent ? new Date(row.last_sent) : null;
    const firstSeen = row?.first_seen ? new Date(row.first_seen) : null;
    return { send: isNotificationDue(lastSent), ongoingHours: ongoingHoursSince(firstSeen) };
  } catch {
    return { send: true, ongoingHours: 0 };
  }
}

async function markSent(key: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(dbUrl);
    await sql`
      UPDATE alert_state SET last_sent = NOW(), send_count = send_count + 1
      WHERE fingerprint = ${key}
    `;
  } catch {
    // Best effort. Failing to record a send costs a duplicate next tick, which
    // is the safe direction.
  }
}

/**
 * The condition cleared. Send an all-clear if we had told anyone about it, and
 * forget it either way.
 *
 * This is what makes the alarm trustworthy rather than merely loud: without it,
 * silence after an alert is ambiguous between "fixed" and "the monitor died".
 * On 2026-08-28 the /api/cii alerts simply stopped when the perf fix deployed,
 * and nothing said so — the operator had to infer it from the absence.
 */
export async function clearAlert(key: string, note?: string): Promise<AlertResult> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return { delivered: false, channel: 'none', detail: 'no_db' };
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(dbUrl);
    const rows = (await sql`
      DELETE FROM alert_state WHERE fingerprint = ${key}
      RETURNING title, last_sent, EXTRACT(EPOCH FROM (NOW() - first_seen)) / 3600 AS ongoing_hours
    `) as unknown as Array<{ title: string; last_sent: string | null; ongoing_hours: number }>;
    const row = rows[0];
    // Nothing was ever sent, so there is nothing to stand down.
    if (!row || !row.last_sent) return { delivered: false, channel: 'suppressed', detail: 'nothing_to_clear' };
    const hours = Math.floor(Number(row.ongoing_hours ?? 0));
    return await deliver({
      title: `RESOLVED — ${row.title}`,
      body: `${note ? `${note}\n\n` : ''}This condition is no longer detected. It lasted about ${hours}h.`,
      severity: 'warning',
    });
  } catch (err) {
    return { delivered: false, channel: 'none', detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Send on the best channel available, with no deduplication. */
async function deliver(a: AlertInput): Promise<AlertResult> {
  const webhook = process.env.DISCORD_APPROVAL_WEBHOOK_URL;
  const discordEnabled = process.env.DISCORD_APPROVAL_ENABLED !== 'false';
  const resendKey = process.env.RESEND_API_KEY;
  const admins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  try {
    if (webhook && discordEnabled) {
      const r = await viaDiscord(webhook, a);
      if (r.delivered) return r;
      // Fall through to email rather than swallowing the failure — a webhook
      // that 404s is indistinguishable from an unset one to the person who
      // needed the alert.
    }
    if (resendKey && admins.length > 0) return await viaEmail(resendKey, admins, a);
  } catch (err) {
    return { delivered: false, channel: 'none', detail: err instanceof Error ? err.message : String(err) };
  }

  // Loudly, in the runtime log, so an unreachable alarm is at least visible to
  // anyone who looks — and say WHY, so it is fixable.
  const why = !resendKey ? 'RESEND_API_KEY unset' : admins.length === 0 ? 'ADMIN_EMAILS empty' : 'no channel';
  console.error(`[alert] UNDELIVERED (${why}) — ${a.title}: ${a.body.slice(0, 400)}`);
  return { delivered: false, channel: 'none', detail: why };
}

/**
 * Clear every condition under `prefix` that is no longer active.
 *
 * The reason this exists rather than a single clearAlert call: an endpoint
 * condition is keyed by WHICH endpoints are affected, so the key changes when
 * the set changes. Without this, "cii and briefs-sample are down" resolving to
 * "only briefs-sample is down" would leave the first condition on the books
 * forever, and its all-clear would never be sent.
 *
 * Returns the keys it stood down, so a caller can report honestly.
 */
export async function clearStaleAlerts(prefix: string, activeKeys: string[]): Promise<string[]> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return [];
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(dbUrl);
    const rows = (await sql`
      SELECT fingerprint FROM alert_state
      WHERE fingerprint LIKE ${prefix + '%'}
        AND NOT (fingerprint = ANY(${activeKeys}))
    `) as unknown as Array<{ fingerprint: string }>;
    const cleared: string[] = [];
    for (const r of rows) {
      await clearAlert(r.fingerprint);
      cleared.push(r.fingerprint);
    }
    return cleared;
  } catch {
    return [];
  }
}

/**
 * Raise an alert on the best channel actually available. Never throws.
 *
 * With a `key`, one ongoing condition produces ONE notification plus a
 * reminder every ALERT_REMINDER_HOURS — not one per cron tick. Without a key
 * it always sends, which is right for genuinely one-off events and wrong for
 * anything a cron evaluates on a schedule.
 */
export async function raiseAlert(a: AlertInput): Promise<AlertResult> {
  if (!a.key) return await deliver(a);

  const { send, ongoingHours } = await shouldNotify(a.key, a);
  if (!send) {
    // Visible in the runtime log, so a suppressed alert is never invisible —
    // it is just not in someone's inbox for the ninth time.
    console.log(`[alert] suppressed (ongoing ${ongoingHours}h, key=${a.key}) — ${a.title}`);
    return { delivered: false, channel: 'suppressed', detail: `ongoing_${ongoingHours}h` };
  }

  const body = ongoingHours > 0 ? `${a.body}\n\nOngoing for about ${ongoingHours}h — still not resolved.` : a.body;
  const result = await deliver({ ...a, body });
  if (result.delivered) await markSent(a.key);
  return result;
}
