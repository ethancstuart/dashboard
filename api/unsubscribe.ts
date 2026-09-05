import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { verifyUnsubscribeToken } from './_lib/unsubscribe-token.js';

export const config = { runtime: 'nodejs' };

/**
 * One-click unsubscribe. GET renders a confirmation page; POST (RFC 8058
 * List-Unsubscribe-Post) acts silently, which is what mail clients send when
 * the reader taps their built-in unsubscribe button.
 *
 * The token is an HMAC over the email (see _lib/unsubscribe-token.ts): the
 * endpoint mutates a single boolean for a single address and only for a link
 * that could only have come from that address's own email. No session, no
 * cookie — a reader clicking from their mail client has neither.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const email = String(req.query.e ?? '')
    .trim()
    .toLowerCase();
  const token = String(req.query.t ?? '');

  const page = (title: string, body: string, status = 200) =>
    res
      .status(status)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(
        `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<title>${title}</title>` +
          `<body style="font-family:Georgia,serif;background:#FAF8F3;color:#12161C;display:grid;place-items:center;min-height:90vh;margin:0">` +
          `<div style="max-width:28rem;padding:2rem;text-align:center">` +
          `<h1 style="font-size:1.4rem;font-weight:600">${title}</h1>` +
          `<p style="line-height:1.6;color:#4a4f57">${body}</p></div>`,
      );

  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    // Invalid or forged link. Say so without confirming whether the address
    // is subscribed — this endpoint must not be an existence oracle.
    return page(
      'That link didn’t work',
      'The unsubscribe link is invalid or has expired. Reply to any brief and a human will remove you.',
      400,
    );
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return page('Something broke', 'Please reply to any brief and a human will remove you.', 500);

  try {
    const sql = neon(dbUrl);
    await sql`UPDATE email_subscribers SET unsubscribed = TRUE WHERE LOWER(email) = ${email}`;
  } catch (err) {
    console.error('[unsubscribe] update failed:', err instanceof Error ? err.message : err);
    return page('Something broke', 'Please reply to any brief and a human will remove you.', 500);
  }

  if (req.method === 'POST') return res.status(200).json({ ok: true });
  return page(
    'You’re unsubscribed',
    'No more briefs. If this was a mistake, subscribing again on the site takes one field.',
  );
}
