import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { requireCron } from '../_cron-utils.js';
import { assessLedgerTruth, GRACE_DAYS, type PendingCall } from '../_lib/ledger-truth.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

/**
 * Ledger-truth assertion (daily, 10:15 UTC — 30 minutes after resolve-calls).
 *
 * ONE ASSERTION: no call may sit in `status = 'pending'` more than GRACE_DAYS
 * past its own `resolves_on`. The track record is the product; a call that
 * never resolves is a claim quietly withdrawn, and today nothing notices.
 *
 * `resolve-calls` deliberately leaves a row pending when its resolver cannot
 * reach the upstream that would settle it — the right call, and an entirely
 * silent one: the run returns 200 and the row sits there. This is the alarm.
 *
 * ALERTING IS BEST-EFFORT, THE ASSERTION IS NOT. DISCORD_APPROVAL_WEBHOOK_URL
 * is unset in production today, so the Discord post is a no-op. That must not
 * be allowed to look like "the ledger is fine": when the webhook is missing the
 * finding is written to the runtime log at error level with a stable, greppable
 * prefix, and it is returned in the JSON body with `alertingDisabled: true`.
 * The handler still reports 200, because the CRON succeeded — it is the LEDGER
 * that is unhealthy, and conflating the two would make the cron's own failure
 * rate meaningless.
 *
 * 2026-08-28 — item 1.4.
 */

const ALERT_PREFIX = '[ledger-truth] ALERT';
const SAMPLE_LIMIT = 20;

async function postDiscord(webhook: string, title: string, body: string): Promise<boolean> {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'NexusWatch Ledger',
        embeds: [
          {
            title,
            description: body.slice(0, 3900),
            color: 0xdc2626,
            timestamp: new Date().toISOString(),
            footer: { text: 'nexuswatch.dev — ledger truth assertion' },
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(`${ALERT_PREFIX} DATABASE_URL is not configured — the assertion could not run`);
    return res.status(500).json({ error: 'database_not_configured' });
  }
  const sql = neon(dbUrl);

  let stale: PendingCall[];
  let staleCount: number;
  try {
    // COUNT(*) separately from the sample, so a truncated sample can never be
    // reported as the whole problem. (Same reason as the 2026-08-28 ledger
    // commit: counts come from COUNT(*), not from the length of a LIMITed page.)
    const counted = (await sql`
      SELECT COUNT(*)::int AS n
      FROM calls
      WHERE status = 'pending' AND resolves_on < CURRENT_DATE - ${GRACE_DAYS}
    `) as unknown as Array<{ n: number }>;
    staleCount = counted[0]?.n ?? 0;

    stale = (await sql`
      SELECT id, kind, country_code, made_on::text AS made_on, resolves_on::text AS resolves_on
      FROM calls
      WHERE status = 'pending' AND resolves_on < CURRENT_DATE - ${GRACE_DAYS}
      ORDER BY resolves_on ASC
      LIMIT ${SAMPLE_LIMIT}
    `) as unknown as PendingCall[];
  } catch (err) {
    console.error(`${ALERT_PREFIX} query failed`, err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'query_failed' });
  }

  const verdict = assessLedgerTruth(stale, new Date(), SAMPLE_LIMIT);

  if (verdict.ok && staleCount === 0) {
    return res.status(200).json({ ok: true, ledgerTruthful: true, staleCount: 0, graceDays: GRACE_DAYS });
  }

  // The sample is LIMITed; the count is authoritative.
  const body = verdict.lines.join('\n');
  const title = `Ledger truth — ${staleCount} call(s) overdue and still pending`;

  const webhook = process.env.DISCORD_APPROVAL_WEBHOOK_URL;
  const enabled = process.env.DISCORD_APPROVAL_ENABLED !== 'false';

  if (!webhook || !enabled) {
    // LOUD no-op. This is the branch production takes today.
    console.error(
      `${ALERT_PREFIX} ${title}\n${body}\n${ALERT_PREFIX} not delivered: ` +
        `${!webhook ? 'DISCORD_APPROVAL_WEBHOOK_URL is unset' : 'DISCORD_APPROVAL_ENABLED=false'}. ` +
        `This finding is real and unsent.`,
    );
    return res.status(200).json({
      ok: true,
      ledgerTruthful: false,
      staleCount,
      graceDays: GRACE_DAYS,
      alertingDisabled: true,
      alertingDisabledReason: !webhook ? 'no_webhook' : 'disabled',
      sample: verdict.sample,
    });
  }

  const sent = await postDiscord(webhook, title, body);
  if (!sent) {
    console.error(
      `${ALERT_PREFIX} ${title}\n${body}\n${ALERT_PREFIX} Discord post FAILED — finding is real and unsent.`,
    );
  }

  return res.status(200).json({
    ok: true,
    ledgerTruthful: false,
    staleCount,
    graceDays: GRACE_DAYS,
    alertSent: sent,
    sample: verdict.sample,
  });
}
