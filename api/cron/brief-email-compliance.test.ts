import { describe, it, expect } from 'vitest';
import { renderDossierEmail } from './daily-brief.js';
import {
  UNSUB_PLACEHOLDER,
  personalizeUnsubscribe,
  unsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from '../_lib/unsubscribe-token.js';

/**
 * THE BUG PAIR THIS LOCKS DOWN (found 2026-08-28, still live 2026-09-05):
 *
 * 1. deliver-briefs sent `summary` — beehiivHtml, inner modules only — so the
 *    email a real subscriber received had no footer and no unsubscribe at all.
 * 2. The footer that DID exist in the unused emailHtml linked
 *    `#/unsubscribe` and `#/preferences` — routes that have NEVER been in the
 *    router. Every actionable footer link was a 404.
 *
 * One body is rendered per day for every recipient, so the fix is a
 * placeholder substituted per recipient at send time with an HMAC-signed URL.
 */

const rendered = () =>
  renderDossierEmail({
    briefText: "## 🎯 Today's Call\n\nSudan deteriorating.\n",
    date: '2026-09-05',
    time: '10:00 UTC',
    markets: [],
  });

describe('the delivered email is lawful to send', () => {
  it('emailHtml is a full standalone document', () => {
    const { emailHtml } = rendered();
    expect(emailHtml.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(emailHtml).toContain('</html>');
  });

  it('emailHtml and plainText carry the per-recipient unsubscribe placeholder', () => {
    const { emailHtml, plainText } = rendered();
    expect(emailHtml).toContain(`href="${UNSUB_PLACEHOLDER}"`);
    expect(plainText).toContain(`Unsubscribe: ${UNSUB_PLACEHOLDER}`);
  });

  it('no footer link points at a route that does not exist', () => {
    const { emailHtml, plainText } = rendered();
    for (const body of [emailHtml, plainText]) {
      expect(body).not.toContain('#/unsubscribe');
      expect(body).not.toContain('#/preferences');
    }
  });

  it('beehiivHtml stays an embeddable fragment', () => {
    const { beehiivHtml } = rendered();
    expect(beehiivHtml).not.toContain('<!DOCTYPE');
    expect(beehiivHtml).not.toContain('<html');
  });
});

describe('unsubscribe tokens', () => {
  const OLD = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = OLD || 'test-secret-for-vitest';

  it('substitutes a signed per-recipient URL', () => {
    const body = `before ${UNSUB_PLACEHOLDER} after`;
    const out = personalizeUnsubscribe(body, 'Reader@Example.com');
    expect(out).not.toContain(UNSUB_PLACEHOLDER);
    expect(out).toContain('/api/unsubscribe?e=reader%40example.com&t=');
  });

  it('round-trips: the URL it mints verifies', () => {
    const t = unsubscribeToken('reader@example.com')!;
    expect(verifyUnsubscribeToken('reader@example.com', t)).toBe(true);
  });

  it('rejects a token for a different address — no unsubscribing strangers', () => {
    const t = unsubscribeToken('reader@example.com')!;
    expect(verifyUnsubscribeToken('victim@example.com', t)).toBe(false);
  });

  it('rejects tampered and empty tokens', () => {
    const t = unsubscribeToken('reader@example.com')!;
    expect(verifyUnsubscribeToken('reader@example.com', t.slice(0, -1) + (t.endsWith('0') ? '1' : '0'))).toBe(false);
    expect(verifyUnsubscribeToken('reader@example.com', '')).toBe(false);
  });

  it('is case-insensitive on the address, matching the DB lookup', () => {
    expect(unsubscribeToken('Reader@Example.com')).toBe(unsubscribeToken('reader@example.com'));
  });

  it('falls back to a REAL route when no secret is configured', () => {
    const a = process.env.AUTH_SECRET;
    const c = process.env.CRON_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.CRON_SECRET;
    try {
      expect(unsubscribeUrl('x@y.dev')).toBe('https://nexuswatch.dev/settings');
    } finally {
      if (a) process.env.AUTH_SECRET = a;
      if (c) process.env.CRON_SECRET = c;
    }
  });
});
