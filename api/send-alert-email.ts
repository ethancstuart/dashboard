import type { VercelRequest, VercelResponse } from '@vercel/node';
// `s` and `ts` used to be defined locally here, and both built the style
// attribute WITHOUT escaping — which truncated every declaration list at the
// first quote in a font stack. They are now aliases for the shared, escaping
// helpers so a private unescaped copy cannot reappear.
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

const CORS_ORIGIN = 'https://nexuswatch.dev';

/** Map alert severity to a semantic color from the dossier palette. */
function severityColor(sev: string): string {
  if (sev === 'critical') return colors.down;
  if (sev === 'elevated') return colors.accent;
  return colors.divider;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

  const { to, subject, alertText, severity, lat, lon } = req.body as {
    to: string;
    subject: string;
    alertText: string;
    severity: string;
    lat?: number;
    lon?: number;
  };

  if (!to || !subject || !alertText) {
    return res.status(400).json({ error: 'to, subject, alertText required' });
  }

  const sevColor = severityColor(severity);
  const mapLink =
    lat && lon
      ? `https://nexuswatch.dev/#/intel?v=${btoa(JSON.stringify({ c: [lon, lat], z: 6, p: 10, b: 0, l: [] }))}`
      : 'https://nexuswatch.dev';

  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NexusWatch Alert</title>
</head>
<body ${s({ margin: '0', padding: '0', background: colors.bgPage, fontFamily: fonts.sans })}>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ${s({ background: colors.bgPage, padding: `${space.xl} ${space.md}` })}>
    <tr><td align="center">
      <table role="presentation" width="${layout.contentWidth}" cellpadding="0" cellspacing="0" border="0" ${s({ maxWidth: layout.contentWidth, background: colors.bgCard, borderRadius: layout.radiusCard, border: `1px solid ${colors.border}`, padding: layout.gutter })}>
        <tr><td>
          <div ${s({ borderBottom: `2px solid ${colors.divider}`, paddingBottom: space.md, marginBottom: space.lg })}>
            <span ${ts(type.kicker, { color: colors.accent })}>NEXUSWATCH ALERT</span>
          </div>
          <div ${s({ display: 'inline-block', padding: `2px ${space.sm}`, background: `${sevColor}15`, border: `1px solid ${sevColor}`, borderRadius: layout.radiusCallout, marginBottom: space.md })}>
            <span ${ts(type.kicker, { color: sevColor })}>${severity.toUpperCase()}</span>
          </div>
          <div ${ts(type.body, { color: colors.textPrimary, marginBottom: space.xl })}>
            ${alertText}
          </div>
          <a href="${mapLink}" ${s({ display: 'inline-block', padding: `${space.md} ${space.xl}`, background: colors.accent, color: colors.textInverse, textDecoration: 'none', borderRadius: layout.radiusCallout, fontFamily: fonts.mono, fontSize: '11px', fontWeight: '700', letterSpacing: '0.12em', textTransform: 'uppercase' })}>
            View on Map →
          </a>
          <div ${s({ marginTop: space.xl, paddingTop: space.md, borderTop: `1px solid ${colors.border}`, textAlign: 'center' })}>
            <span ${ts(type.caption, { color: colors.textTertiary })}>NexusWatch Intelligence · nexuswatch.dev · Unsubscribe in account settings</span>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'NexusWatch Alerts <alerts@nexuswatch.dev>',
        to: [to],
        subject,
        html: emailHtml,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Resend error:', err);
      return res.status(502).json({ error: 'Email delivery failed' });
    }

    const data = await response.json();
    return res.json({ success: true, id: (data as Record<string, unknown>).id });
  } catch (err) {
    console.error('Email error:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Email delivery failed' });
  }
}
