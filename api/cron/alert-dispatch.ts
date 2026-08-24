import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

export const config = { runtime: 'nodejs', maxDuration: 120 };

/**
 * 3-Tier Alert Dispatch (D-4, 2026-04-18).
 *
 * Runs every 30 minutes. Checks CII scores against 3 urgency tiers:
 *
 * WATCH 🟡    — CII > 50 or Δ24h > +5
 *               Bundled in daily brief (not sent as separate email).
 *               Logged for brief template to include.
 *
 * ELEVATED 🟠 — CII > 65 or Δ24h > +10
 *               Separate email, batched hourly.
 *               Subject: "🟠 ELEVATED: [Country]"
 *
 * CRITICAL 🔴 — CII > 80 or crisis_trigger active or multi-signal convergence
 *               Immediate send to all channels (email + Slack + Telegram + webhook).
 *               Subject: "🔴 CRITICAL: [Country]"
 *
 * Schedule: * /30 * * * * (every 30 min, same as existing slack/telegram alerts)
 */

interface AlertTier {
  tier: 'watch' | 'elevated' | 'critical';
  emoji: string;
  label: string;
  color: string;
}

const TIERS: Record<string, AlertTier> = {
  critical: { tier: 'critical', emoji: '🔴', label: 'CRITICAL', color: '#dc2626' },
  elevated: { tier: 'elevated', emoji: '🟠', label: 'ELEVATED', color: '#ff6600' },
  watch: { tier: 'watch', emoji: '🟡', label: 'WATCH', color: '#e5a913' },
};

interface CiiScore {
  country_code: string;
  country_name: string;
  score: number;
  deviation: number;
  prev_score: number | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  // 1. Get current CII scores + 24h-ago scores for delta calculation
  const scores = await sql`
    SELECT
      h.country_code,
      h.country_name,
      h.score,
      h.deviation,
      s.cii_score AS prev_score
    FROM (
      SELECT DISTINCT ON (country_code) country_code, country_name, score,
             COALESCE((components->>'deviation')::float, 0) AS deviation
      FROM country_cii_history
      ORDER BY country_code, timestamp DESC
    ) h
    LEFT JOIN cii_daily_snapshots s
      ON s.country_code = h.country_code
      AND s.date = (CURRENT_DATE - INTERVAL '1 day')::date
  `;

  // 2. Check for active crisis triggers
  const crisisTriggers = await sql`
    SELECT country_code, playbook_key, trigger_type, cii_score, magnitude
    FROM crisis_triggers
    WHERE resolved_at IS NULL
      AND triggered_at > NOW() - INTERVAL '24 hours'
  `;
  const crisisCountries = new Set(crisisTriggers.map((c) => c.country_code as string));

  // 3. Classify each country into tiers
  const alerts: Array<{
    country_code: string;
    country_name: string;
    score: number;
    delta: number;
    tier: AlertTier;
    signals: string[];
  }> = [];

  for (const row of scores as CiiScore[]) {
    const hasCrisis = crisisCountries.has(row.country_code);
    const signals: string[] = [];

    let tier: AlertTier | null = null;

    // Alerts fire on the DEVIATION — today's live signal — never on the
    // structural level (post-split, 2026-08-23). The level is a standing
    // fact: Syria is structurally severe every single day, and an alert
    // that fires on a standing fact is spam that trains people to
    // unsubscribe. What is alertable is what CHANGED: the deviation is
    // exactly that, and it mean-reverts, so an absolute threshold reads
    // as "unusually loud today".
    // CRITICAL: deviation ≥ 12 OR active crisis trigger
    if (row.deviation >= 12 || hasCrisis) {
      tier = TIERS.critical;
      if (row.deviation >= 12) signals.push(`live deviation +${row.deviation.toFixed(1)} (structural ${row.score})`);
      if (hasCrisis) signals.push('Active crisis trigger');
    }
    // ELEVATED: deviation ≥ 8
    else if (row.deviation >= 8) {
      tier = TIERS.elevated;
      signals.push(`live deviation +${row.deviation.toFixed(1)} (structural ${row.score})`);
    }
    // WATCH: deviation ≥ 4
    else if (row.deviation >= 4) {
      tier = TIERS.watch;
      signals.push(`live deviation +${row.deviation.toFixed(1)} (structural ${row.score})`);
    }

    if (tier) {
      alerts.push({
        country_code: row.country_code,
        country_name: row.country_name,
        score: row.score,
        delta: row.deviation,
        tier,
        signals,
      });
    }
  }

  // 4. Log alerts to alert_dispatch_log for dedup + dashboard visibility
  const criticalAlerts = alerts.filter((a) => a.tier.tier === 'critical');
  const elevatedAlerts = alerts.filter((a) => a.tier.tier === 'elevated');
  const watchAlerts = alerts.filter((a) => a.tier.tier === 'watch');

  // 5. Send CRITICAL alerts immediately
  const resendKey = process.env.RESEND_API_KEY;
  let criticalSent = 0;

  if (criticalAlerts.length > 0 && resendKey) {
    // Get all alert subscribers
    const subscribers = await sql`
      SELECT email, country_codes, cii_threshold
      FROM email_alert_subscriptions
      WHERE active = TRUE AND verified = TRUE
    `;

    for (const alert of criticalAlerts) {
      // Check dedup: don't re-send if we already alerted for this country today at this tier
      const existing = await sql`
        SELECT 1 FROM crisis_triggers
        WHERE country_code = ${alert.country_code}
          AND dedup_key = ${`alert-critical-${alert.country_code}-${today}`}
        LIMIT 1
      `;
      if (existing.length > 0) continue;

      // Find subscribers watching this country
      const recipients = subscribers.filter((s) => {
        const codes = s.country_codes as string[] | null;
        const threshold = s.cii_threshold as number | null;
        if (codes && codes.length > 0 && !codes.includes(alert.country_code)) return false;
        if (threshold && alert.score < threshold) return false;
        return true;
      });

      if (recipients.length === 0) continue;

      const subject = `${alert.tier.emoji} ${alert.tier.label}: ${alert.country_name} — CII ${alert.score}`;
      const alertHtml = renderAlertEmail(alert, 'critical');

      // Send via Resend batch
      const emails = recipients.map((r) => r.email as string);
      const BATCH_SIZE = 100;
      for (let i = 0; i < emails.length; i += BATCH_SIZE) {
        const chunk = emails.slice(i, i + BATCH_SIZE);
        const payload = chunk.map((email) => ({
          from: 'NexusWatch Alerts <alerts@nexuswatch.dev>',
          to: [email],
          subject,
          html: alertHtml,
        }));

        try {
          const resp = await fetch('https://api.resend.com/emails/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${resendKey}`,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15000),
          });
          if (resp.ok) {
            criticalSent += chunk.length;
          } else {
            const body = await resp.text().catch(() => '');
            console.error(`[alert-dispatch] Resend error ${resp.status}: ${body.slice(0, 200)}`);
          }
        } catch (err) {
          console.error(
            `[alert-dispatch] Critical alert send failed for ${alert.country_code}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      // Record dedup key
      try {
        await sql`
          INSERT INTO crisis_triggers (country_code, playbook_key, trigger_type, cii_score, magnitude, dedup_key)
          VALUES (${alert.country_code}, ${'alert-dispatch'}, ${'critical-alert'}, ${alert.score}, ${alert.delta}, ${`alert-critical-${alert.country_code}-${today}`})
          ON CONFLICT (dedup_key) DO NOTHING
        `;
      } catch {
        /* dedup insert is best-effort */
      }
    }
  }

  // 6. ELEVATED alerts are batched — just log them for the hourly deliver-briefs to pick up
  // For now, store in a KV-style log. The deliver-briefs cron will check for elevated alerts
  // and send them as separate emails when delivering the timezone-aware briefs.

  // 7. WATCH alerts are bundled into the daily brief — no separate email needed.
  // The brief template's "CII Movers" section already handles this via the data context.

  console.log(
    `[alert-dispatch] ${alerts.length} total: ${criticalAlerts.length} critical (${criticalSent} emails sent), ${elevatedAlerts.length} elevated, ${watchAlerts.length} watch`,
  );

  return res.status(200).json({
    success: true,
    date: today,
    summary: {
      total: alerts.length,
      critical: criticalAlerts.length,
      elevated: elevatedAlerts.length,
      watch: watchAlerts.length,
      criticalEmailsSent: criticalSent,
    },
    criticalCountries: criticalAlerts.map((a) => ({
      code: a.country_code,
      name: a.country_name,
      score: a.score,
      delta: a.delta,
      signals: a.signals,
    })),
  });
}

/**
 * Render a tier-specific alert email with severity-colored header.
 */
function renderAlertEmail(
  alert: {
    country_code: string;
    country_name: string;
    score: number;
    delta: number;
    tier: AlertTier;
    signals: string[];
  },
  _tierKey: string,
): string {
  const tierInfo = alert.tier;
  const deltaStr = alert.delta >= 0 ? `+${alert.delta.toFixed(1)}` : alert.delta.toFixed(1);
  const mapLink = `https://nexuswatch.dev/#/intel?country=${alert.country_code}`;
  const auditLink = `https://nexuswatch.dev/#/audit/${alert.country_code}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NexusWatch ${tierInfo.label} Alert</title>
</head>
<body style="margin:0;padding:0;background:#faf8f3;font-family:'Inter',system-ui,sans-serif;color:#12161c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf8f3;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;border:1px solid #e5e0d4;overflow:hidden;">
        <!-- Tier-colored header bar -->
        <tr><td style="background:${tierInfo.color};padding:16px 24px;">
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:0.12em;color:#ffffff;">${tierInfo.emoji} NEXUSWATCH ${tierInfo.label} ALERT</span>
        </td></tr>
        <!-- Content -->
        <tr><td style="padding:24px;">
          <h1 style="font-family:'Inter',sans-serif;font-size:24px;font-weight:700;color:#12161c;margin:0 0 8px;">${alert.country_name}</h1>
          <div style="display:inline-block;padding:4px 12px;background:${tierInfo.color}15;border:1px solid ${tierInfo.color};border-radius:4px;margin-bottom:16px;">
            <span style="font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:${tierInfo.color};">CII ${alert.score} (${deltaStr} 24h)</span>
          </div>
          <div style="font-family:'Inter',sans-serif;font-size:14px;color:#3d3832;line-height:1.6;margin-bottom:20px;">
            <strong>Trigger signals:</strong>
            <ul style="margin:8px 0;padding-left:20px;">
              ${alert.signals.map((s) => `<li>${s}</li>`).join('\n              ')}
            </ul>
          </div>
          <div style="margin-bottom:20px;">
            <a href="${mapLink}" style="display:inline-block;padding:10px 24px;background:${tierInfo.color};color:#ffffff;text-decoration:none;border-radius:6px;font-family:'Inter',sans-serif;font-size:13px;font-weight:700;margin-right:8px;">View on Map</a>
            <a href="${auditLink}" style="display:inline-block;padding:10px 24px;background:transparent;color:${tierInfo.color};text-decoration:none;border-radius:6px;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;border:1px solid ${tierInfo.color};">Audit Trail</a>
          </div>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 24px;border-top:1px solid #e5e0d4;text-align:center;">
          <span style="font-family:'Inter',sans-serif;font-size:11px;color:#8b8478;">NexusWatch Intelligence · nexuswatch.dev · Unsubscribe in account settings</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
