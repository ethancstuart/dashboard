import { describe, it, expect } from 'vitest';
import { renderDossierEmail } from './daily-brief.js';

/**
 * The bug this locks down (2026-08-28): deliver-briefs.ts sent
 * `daily_briefs.summary` — which is `beehiivHtml`, inner modules only — as the
 * Resend message body. beehiiv supplies its own masthead, footer and
 * unsubscribe; Resend supplies none of them. So every brief a real subscriber
 * received had no unsubscribe link at all.
 *
 * Two invariants, pulling in OPPOSITE directions, which is why both live here:
 * the email must be a complete document with a way out, and `summary` must
 * stay an embeddable fragment because api/briefs.ts and src/ui/briefPanel.ts
 * inject it straight into the archive page's DOM.
 *
 * The unsubscribe assertion derives from the rendered OUTPUT rather than
 * checking that some named helper was called, so a rewrite of the footer that
 * drops the link fails here regardless of how it is structured.
 */

const rendered = () =>
  renderDossierEmail({
    briefText: '# Situation Brief\n\nSudan deteriorating.\n',
    date: '2026-08-28',
    time: '10:00 UTC',
    markets: [],
  });

const UNSUB_HREF = /href="[^"]*unsubscribe[^"]*"/i;

describe('the delivered email is lawful to send', () => {
  it('emailHtml is a full standalone document', () => {
    const { emailHtml } = rendered();
    expect(emailHtml.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(emailHtml).toContain('</html>');
  });

  it('emailHtml carries a working unsubscribe link', () => {
    const { emailHtml } = rendered();
    expect(emailHtml).toMatch(UNSUB_HREF);
  });

  it('plainText carries an unsubscribe URL for the text/plain part', () => {
    const { plainText } = rendered();
    expect(plainText.toLowerCase()).toContain('unsubscribe');
    expect(plainText).toMatch(/https?:\/\/\S*unsubscribe/i);
  });
});

describe('summary stays embeddable — the archive page injects it into a div', () => {
  it('beehiivHtml is a fragment, not a document', () => {
    const { beehiivHtml } = rendered();
    expect(beehiivHtml).not.toContain('<!DOCTYPE');
    expect(beehiivHtml).not.toContain('<html');
    expect(beehiivHtml).not.toContain('<body');
    expect(beehiivHtml.trimStart().startsWith('<div')).toBe(true);
  });
});
