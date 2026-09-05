import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
// `s` and `ts` used to be defined locally here, and both built the style
// attribute WITHOUT escaping — which truncated every declaration list at the
// first quote in a font stack. This is the WELCOME email, so that made the
// first thing a new subscriber ever saw the worst-rendered of the three.
// They are now aliases for the shared, escaping helpers.
import {
  colors,
  fonts,
  type,
  space,
  layout,
  styleAttrOf as s,
  typeStyleAttr as ts,
} from '../src/styles/email-tokens.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', 'https://nexuswatch.dev');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'Database not configured' });

  const { email, source, timezone } = req.body as { email?: string; source?: string; timezone?: string };
  if (!email || !email.includes('@') || email.length < 5) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  // The browser knows the reader's zone (Intl.DateTimeFormat), but validate
  // against the shape of an IANA name and never trust it into SQL semantics:
  // deliver-briefs buckets on `NOW() AT TIME ZONE tz`, and an invalid zone
  // there errors the whole delivery query for everyone. Unknown → UTC, which
  // means "7am UTC" rather than "never delivered" — the failure this fixes:
  // subscribe.ts NEVER wrote timezone, every new subscriber's zone was NULL,
  // and a NULL zone matches no delivery bucket at all.
  const tz =
    typeof timezone === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(timezone) && timezone.length <= 64
      ? timezone
      : 'UTC';

  try {
    const sql = neon(dbUrl);
    await sql`
      INSERT INTO email_subscribers (email, source, timezone)
      VALUES (${email.toLowerCase().trim()}, ${source || 'landing'}, ${tz})
      ON CONFLICT (email) DO UPDATE
        SET unsubscribed = FALSE,
            timezone = COALESCE(email_subscribers.timezone, EXCLUDED.timezone)
    `;

    // Send welcome email via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: 'NexusWatch <hello@nexuswatch.dev>',
            to: [email.toLowerCase().trim()],
            subject: 'Welcome to NexusWatch Intelligence',
            html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to NexusWatch</title></head>
<body ${s({ margin: '0', padding: '0', background: colors.bgPage, fontFamily: fonts.sans })}>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ${s({ background: colors.bgPage, padding: `${space.xl} ${space.md}` })}>
    <tr><td align="center">
      <table role="presentation" width="${layout.contentWidth}" cellpadding="0" cellspacing="0" border="0" ${s({ maxWidth: layout.contentWidth, background: colors.bgCard, borderRadius: layout.radiusCard, border: `1px solid ${colors.border}`, padding: layout.gutter })}>
        <tr><td>
          <div ${s({ borderBottom: `2px solid ${colors.divider}`, paddingBottom: space.md, marginBottom: space.lg, textAlign: 'center' })}>
            <span ${ts(type.masthead, { color: colors.textPrimary, letterSpacing: '-0.01em' })}>NexusWatch</span>
          </div>
          <p ${ts(type.bodyLarge, { color: colors.textPrimary, margin: `0 0 ${space.md} 0` })}>You're now subscribed to the NexusWatch Daily Intelligence Brief.</p>
          <p ${ts(type.body, { color: colors.textSecondary, margin: `0 0 ${space.lg} 0` })}>Every morning, you'll receive an AI-generated intelligence briefing covering:</p>
          <div ${s({ margin: `0 0 ${space.xl} 0` })}>
            <div ${ts(type.body, { color: colors.textPrimary, margin: `0 0 ${space.sm} 0`, paddingLeft: space.lg })}><span ${s({ color: colors.accent, marginRight: space.sm })}>▸</span>Top stories — the developments worth your attention</div>
            <div ${ts(type.body, { color: colors.textPrimary, margin: `0 0 ${space.sm} 0`, paddingLeft: space.lg })}><span ${s({ color: colors.accent, marginRight: space.sm })}>▸</span>Country Instability Index — risk scores across 50+ nations</div>
            <div ${ts(type.body, { color: colors.textPrimary, margin: `0 0 ${space.sm} 0`, paddingLeft: space.lg })}><span ${s({ color: colors.accent, marginRight: space.sm })}>▸</span>US impact analysis — why it matters if you're stateside</div>
            <div ${ts(type.body, { color: colors.textPrimary, margin: `0 0 ${space.sm} 0`, paddingLeft: space.lg })}><span ${s({ color: colors.accent, marginRight: space.sm })}>▸</span>Market signal — energy, commodities, and index moves</div>
            <div ${ts(type.body, { color: colors.textPrimary, margin: `0 0 ${space.sm} 0`, paddingLeft: space.lg })}><span ${s({ color: colors.accent, marginRight: space.sm })}>▸</span>48-hour outlook — what to watch next</div>
          </div>
          <div ${s({ textAlign: 'center', margin: `${space.xl} 0` })}>
            <a href="https://nexuswatch.dev" ${s({ display: 'inline-block', padding: `${space.md} ${space.xl}`, background: colors.accent, color: colors.textInverse, textDecoration: 'none', borderRadius: layout.radiusCallout, fontFamily: fonts.mono, fontSize: '11px', fontWeight: '700', letterSpacing: '0.12em', textTransform: 'uppercase' })}>Open NexusWatch →</a>
          </div>
          <div ${s({ marginTop: space.xl, paddingTop: space.md, borderTop: `1px solid ${colors.border}`, textAlign: 'center' })}>
            <span ${ts(type.caption, { color: colors.textTertiary })}>NexusWatch Intelligence · Real-time geopolitical monitoring for 50+ countries</span>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
          }),
        });
      } catch {
        /* Welcome email failed — subscription still saved */
      }
    }

    // Sync to beehiiv publication (non-blocking — subscription is already saved).
    const beehiivKey = process.env.BEEHIIV_API_KEY;
    const beehiivPubId = process.env.BEEHIIV_PUBLICATION_ID;
    if (beehiivKey && beehiivPubId) {
      try {
        const beehiivRes = await fetch(`https://api.beehiiv.com/v2/publications/${beehiivPubId}/subscriptions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${beehiivKey}`,
          },
          body: JSON.stringify({
            email: email.toLowerCase().trim(),
            reactivate_existing: true,
            send_welcome_email: false,
            utm_source: (source as string) || 'landing',
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!beehiivRes.ok) {
          const errText = await beehiivRes.text().catch(() => '');
          console.error(`[subscribe] beehiiv sync failed: ${beehiivRes.status} — ${errText.slice(0, 200)}`);
        }
      } catch (err) {
        console.error('[subscribe] beehiiv sync error:', err instanceof Error ? err.message : err);
      }
    }

    return res.json({ success: true, message: 'Subscribed to NexusWatch Intelligence Brief' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Subscribe error:', msg);
    // Duplicate email (unique constraint) is expected — treat as success
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return res.json({ success: true, message: 'Already subscribed' });
    }
    return res.status(500).json({ success: false, error: 'Subscription failed — try again' });
  }
}
