import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

export const config = { runtime: 'nodejs', maxDuration: 120 };

/**
 * Timezone-aware brief delivery cron (D-2, 2026-04-18).
 *
 * Runs hourly. For each subscriber whose local time is 7:00–7:59 AM and who
 * hasn't already received today's brief, sends the email via Resend.
 *
 * The daily-brief.ts cron generates content at 10:00 UTC and stores it in
 * daily_briefs. This cron only delivers — it never generates.
 *
 * Schedule: 0 * * * * (every hour on the hour)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Cron auth
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const currentUtcHour = now.getUTCHours();

  // 1. Get today's brief from archive
  //
  // `email_html` / `plain_text` arrive with 2026-08-28-brief-email-html.sql.
  // Probe for them rather than assuming: if this code is live before the
  // migration is applied, naming a missing column would fail the SELECT and
  // stop delivery entirely. Absent columns simply mean the legacy path.
  let hasEmailColumns = false;
  try {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'daily_briefs'
        AND column_name IN ('email_html', 'plain_text')
    `;
    hasEmailColumns = cols.length === 2;
  } catch (probeErr) {
    console.error(
      '[deliver-briefs] column probe failed, assuming legacy schema:',
      probeErr instanceof Error ? probeErr.message : probeErr,
    );
  }

  const briefs = hasEmailColumns
    ? await sql`
        SELECT brief_date, summary, content, email_html, plain_text FROM daily_briefs
        WHERE brief_date = ${today}
        LIMIT 1
      `
    : await sql`
        SELECT brief_date, summary, content FROM daily_briefs
        WHERE brief_date = ${today}
        LIMIT 1
      `;

  if (briefs.length === 0) {
    return res.status(200).json({
      success: true,
      skipped: true,
      reason: `No brief generated yet for ${today}. Waiting for daily-brief cron.`,
    });
  }

  // What a subscriber actually receives.
  //
  // `summary` is beehiivHtml — inner modules with no masthead, no permalink
  // and NO UNSUBSCRIBE LINK, because beehiiv supplies that chrome and Resend
  // does not. Sending it directly was a CAN-SPAM / bulk-sender exposure.
  // `email_html` is the full document that carries the unsubscribe footer.
  //
  // The fallback to `summary` is for rows written before the column existed:
  // it restores exactly the previous behaviour rather than failing the send.
  // It is a compatibility path for history, NOT an acceptable steady state —
  // if it is still firing for fresh briefs, generation is not populating the
  // column and the mail is going out non-compliant again.
  const storedEmailHtml = (briefs[0] as { email_html?: unknown }).email_html;
  const usingFullDocument = typeof storedEmailHtml === 'string' && storedEmailHtml.length > 0;
  const briefHtml = usingFullDocument ? (storedEmailHtml as string) : (briefs[0].summary as string);

  const storedPlainText = (briefs[0] as { plain_text?: unknown }).plain_text;
  const briefText = typeof storedPlainText === 'string' && storedPlainText.length > 0 ? storedPlainText : null;

  // Guard: skip if brief generation hasn't completed yet.
  // The placeholder row has summary='generating...' and email_html NULL, so
  // it lands here via the fallback — which is why the compliance warning
  // below sits AFTER this guard rather than before it. Warning first would
  // fire every hour of a pending generation and cry wolf.
  if (!briefHtml || briefHtml === 'generating...') {
    return res.status(200).json({
      success: true,
      skipped: true,
      reason: `Brief for ${today} is still generating. Skipping delivery.`,
    });
  }

  if (!usingFullDocument) {
    console.warn(
      `[deliver-briefs] ${today}: no email_html — sending the fragment with no unsubscribe link. Expected only for briefs predating 2026-08-28.`,
    );
  }

  // 2. Find timezone buckets where local time is 7:00–7:59 AM right now
  //
  // We compute which UTC offsets correspond to 7 AM local time at the current
  // UTC hour. For example, if it's 14:00 UTC, then timezone offset -7 (PDT)
  // has local time 07:00 — that's our target.
  //
  // target_offset = currentUtcHour - 7
  // A subscriber in timezone with UTC offset = target_offset should be sent.
  //
  // We use Postgres AT TIME ZONE to do this properly (handles DST).
  const targetLocalHour = 7;

  // 3. Find subscribers who:
  //    a) Have local hour = 7 right now
  //    b) Haven't been sent today's brief yet
  const subscribers = await sql`
    SELECT es.email, es.timezone
    FROM email_subscribers es
    WHERE es.unsubscribed = FALSE
      AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE es.timezone)) >= ${targetLocalHour}
      AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE es.timezone)) < ${targetLocalHour + 1}
      AND NOT EXISTS (
        SELECT 1 FROM brief_subscriber_delivery bsd
        WHERE bsd.subscriber_email = es.email
          AND bsd.brief_date = ${today}
      )
  `;

  // Also include admin emails (always deliver at this hour if not already sent)
  const adminEmail = process.env.ADMIN_EMAILS;
  const adminEmails: string[] = [];
  if (adminEmail) {
    for (const e of adminEmail.split(',')) {
      const trimmed = e.trim();
      if (trimmed) adminEmails.push(trimmed);
    }
  }

  // Combine subscriber + admin emails, dedup
  const allEmails = new Set<string>();
  subscribers.forEach((s) => allEmails.add(s.email as string));

  // Admin emails: deliver at 13:00 UTC+ (6am PDT / 5am PST — early enough for morning review)
  if (adminEmails.length > 0 && currentUtcHour >= 13) {
    const adminDelivered = await sql`
      SELECT subscriber_email FROM brief_subscriber_delivery
      WHERE brief_date = ${today}
        AND subscriber_email = ANY(${adminEmails})
    `;
    const alreadySent = new Set(adminDelivered.map((r) => r.subscriber_email as string));
    adminEmails.forEach((e) => {
      if (!alreadySent.has(e)) allEmails.add(e);
    });
  }

  if (allEmails.size === 0) {
    return res.status(200).json({
      success: true,
      sent: 0,
      reason: `No subscribers due for delivery at UTC hour ${currentUtcHour}.`,
    });
  }

  // 4. Send via Resend batch API
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(200).json({
      success: false,
      error: 'RESEND_API_KEY not set',
    });
  }

  const recipients = Array.from(allEmails);
  // The subject is the day's story, extracted at generation time from Top
  // Signal (brief-structure.ts). A date-only subject promises nothing; it
  // survives only as the fallback when extraction found no headline.
  const storedSubject = (() => {
    try {
      const c = briefs[0].content as { subject?: unknown } | null;
      return typeof c?.subject === 'string' && c.subject.trim().length >= 4 ? c.subject.trim() : null;
    } catch {
      return null;
    }
  })();
  const subject = storedSubject
    ? `${storedSubject} — The NexusWatch Brief`
    : `NexusWatch Intelligence Brief — ${today}`;
  const from = 'NexusWatch Intelligence <brief@nexuswatch.dev>';
  const BATCH_SIZE = 100;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    // `text` is omitted rather than sent empty when a historical row has no
    // stored plain text — an empty text/plain part reads worse to spam
    // filters than no alternative at all.
    const payload = chunk.map((email) => ({
      from,
      to: [email],
      subject,
      html: briefHtml,
      ...(briefText ? { text: briefText } : {}),
    }));

    try {
      const resp = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });

      if (resp.ok) {
        sent += chunk.length;
      } else {
        const body = await resp.text().catch(() => '');
        console.error(`[deliver-briefs] Resend batch error: ${resp.status} ${body.slice(0, 200)}`);
        failed += chunk.length;
      }
    } catch (err) {
      console.error(`[deliver-briefs] Resend batch exception:`, err instanceof Error ? err.message : err);
      failed += chunk.length;
    }

    // Pace between batches
    if (i + BATCH_SIZE < recipients.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // 5. Record deliveries in dedup table (only for successful sends)
  //    Uses parameterized queries — never sql.unsafe() with user-provided data.
  if (sent > 0) {
    const deliveredEmails = recipients.slice(0, sent);
    try {
      for (const email of deliveredEmails) {
        await sql`
          INSERT INTO brief_subscriber_delivery (subscriber_email, brief_date, channel)
          VALUES (${email}, ${today}, 'resend')
          ON CONFLICT (subscriber_email, brief_date) DO NOTHING
        `;
      }
    } catch (err) {
      console.error(
        '[deliver-briefs] Delivery log insert failed (non-fatal):',
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[deliver-briefs] UTC ${currentUtcHour}:00 — sent=${sent}, failed=${failed}, total_due=${allEmails.size}`,
  );

  return res.status(200).json({
    success: true,
    utcHour: currentUtcHour,
    sent,
    failed,
    totalDue: allEmails.size,
    date: today,
  });
}
