import { describe, it, expect } from 'vitest';
import { shell } from './ssr-shell.js';

const OPTS = { title: 'A title', description: 'A description', canonicalPath: '/ledger' };

describe('shell() unfurl metadata', () => {
  // THE REGRESSION. Before 2026-08-28 this shell declared
  // twitter:card=summary_large_image and emitted no og:image at all, which is
  // the one combination that unfurls to nothing — every /ledger and /call/:id
  // link posted anywhere was a bare url. The two assertions below are a pair
  // on purpose: either alone can be satisfied by the broken version.
  it('emits og:image and twitter:image when an image is supplied', () => {
    const html = shell('<h1>x</h1>', { ...OPTS, ogImage: 'https://nexuswatch.dev/api/og?type=ledger' });
    expect(html).toContain('<meta property="og:image" content="https://nexuswatch.dev/api/og?type=ledger">');
    expect(html).toContain('<meta name="twitter:image" content="https://nexuswatch.dev/api/og?type=ledger">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('never declares a large card without an image to put in it', () => {
    const html = shell('<h1>x</h1>', OPTS);
    expect(html).not.toContain('summary_large_image');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
    expect(html).not.toContain('og:image');
    expect(html).not.toContain('twitter:image');
  });

  it('escapes the ampersand in a query-string image url so the attribute is valid', () => {
    const html = shell('<h1>x</h1>', { ...OPTS, ogImage: 'https://nexuswatch.dev/api/og?type=call&id=47' });
    expect(html).toContain('content="https://nexuswatch.dev/api/og?type=call&amp;id=47"');
  });
});
