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

export type AlertChannel = 'discord' | 'email' | 'none';

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
}

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

/** Raise an alert on the best channel actually available. Never throws. */
export async function raiseAlert(a: AlertInput): Promise<AlertResult> {
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
