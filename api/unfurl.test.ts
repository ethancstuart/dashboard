import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The two SSR pages, rendered end to end, asserted on the HTML a crawler gets.
 *
 * These exist because the shell-level test can pass while a PAGE forgets to
 * pass an image — the shell's ogImage is optional by design (a 404 shell has no
 * card worth showing), so "the shell can emit it" and "the ledger does emit it"
 * are two different claims and only the second one is what a reader sees when
 * they paste the link.
 */

const CALL_ROW = {
  id: 47,
  made_on: '2026-08-22',
  kind: 'censorship_event',
  country_code: 'IR',
  claim: 'OONI records at least one network-interference event in Iran before 5 September 2026.',
  probability: 0.62,
  horizon_days: 14,
  resolves_on: '2026-09-05',
  resolver: 'OONI',
  threshold: 1,
  threshold_pct: null,
  reference_value: null,
  base_rate: 0.4,
  status: 'pending',
  evidence_count: null,
  resolved_at: null,
  void_reason: null,
};

// One tagged-template stub for both handlers. It dispatches on the query text
// rather than on call order, so adding a query to either page does not silently
// shift every later answer onto the wrong shape.
function fakeSql(strings: TemplateStringsArray): unknown[] {
  const q = strings.join(' ').replace(/\s+/g, ' ');
  if (q.includes('COUNT(*) FILTER')) {
    return [{ open: 42, resolved: 0, hits: 0, next_resolves: '2026-09-05', first_call: '2026-08-22' }];
  }
  if (q.includes('FROM calls WHERE id =')) return [CALL_ROW];
  if (q.includes('WHERE country_code =')) return [];
  if (q.includes("WHERE status = 'pending'")) {
    return [
      {
        id: 47,
        kind: 'censorship_event',
        country_code: 'IR',
        claim: CALL_ROW.claim,
        probability: 0.62,
        base_rate: 0.4,
        resolves_on: '2026-09-05',
        status: 'pending',
      },
    ];
  }
  return [];
}

vi.mock('@neondatabase/serverless', () => ({ neon: () => fakeSql }));

function fakeRes() {
  const state = { status: 200, body: '', headers: {} as Record<string, string> };
  const res = {
    setHeader: (k: string, v: string) => {
      state.headers[k] = v;
    },
    status: (n: number) => {
      state.status = n;
      return res;
    },
    send: (b: string) => {
      state.body = b;
      return res;
    },
    state,
  };
  return res;
}

beforeEach(() => {
  process.env.DATABASE_URL = 'postgres://stub';
});

describe('/ledger unfurls', () => {
  it('points og:image and twitter:image at the ledger card', async () => {
    const { default: handler } = await import('./ledger.js');
    const res = fakeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({ method: 'GET', query: {} } as any, res as any);
    const html = res.state.body;
    // Prove this is the SUCCESS path and not the "temporarily unavailable"
    // shell, which carries the same image and would satisfy the meta
    // assertions on its own.
    expect(html).toContain('42');
    expect(html).toContain('calls open');
    expect(html).toContain('<meta property="og:image" content="https://nexuswatch.dev/api/og?type=ledger">');
    expect(html).toContain('<meta name="twitter:image" content="https://nexuswatch.dev/api/og?type=ledger">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });
});

describe('/call/:id unfurls', () => {
  it('points og:image and twitter:image at that call’s own card', async () => {
    const { default: handler } = await import('./call.js');
    const res = fakeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({ method: 'GET', query: { id: '47' } } as any, res as any);
    const html = res.state.body;
    expect(res.state.status).toBe(200);
    // Prove the row was actually rendered, not a 404 shell that happens to
    // carry no image.
    expect(html).toContain('Call #47');
    expect(html).toContain('62%');
    // The & is escaped in the attribute; the url a crawler resolves is
    // /api/og?type=call&id=47.
    expect(html).toContain('<meta property="og:image" content="https://nexuswatch.dev/api/og?type=call&amp;id=47">');
    expect(html).toContain('<meta name="twitter:image" content="https://nexuswatch.dev/api/og?type=call&amp;id=47">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('does not claim a large card for a call that does not exist', async () => {
    const { default: handler } = await import('./call.js');
    const res = fakeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({ method: 'GET', query: { id: 'not-a-number' } } as any, res as any);
    expect(res.state.status).toBe(404);
    expect(res.state.body).not.toContain('summary_large_image');
    expect(res.state.body).not.toContain('og:image');
  });
});

describe('the call card carries the things that make a call worth forwarding', () => {
  it('renders the claim, the stated probability and the resolution date', async () => {
    const { renderCallCard } = await import('./og.js');
    const html = renderCallCard({
      id: 47,
      countryCode: 'IR',
      claim: 'OONI records at least one network-interference event in Iran before 5 September 2026.',
      probability: 0.62,
      resolvesOn: '2026-09-05',
      madeOn: '2026-08-22',
      status: 'pending',
    });
    expect(html).toContain('OONI records at least one network-interference event in Iran before 5 September 2026.');
    expect(html).toContain('62%');
    expect(html).toContain('RESOLVES 2026-09-05');
    expect(html).toContain('CALL #47');
    expect(html).toContain('OPEN');
  });

  it('says HIT or MISS once a call has resolved', async () => {
    const { renderCallCard } = await import('./og.js');
    const base = {
      id: 48,
      countryCode: 'AR',
      claim: 'The peso depreciates 8% against USD inside the window.',
      probability: 0.31,
      resolvesOn: '2026-09-05',
      madeOn: '2026-08-22',
    };
    expect(renderCallCard({ ...base, status: 'hit' })).toContain('HIT');
    expect(renderCallCard({ ...base, status: 'miss' })).toContain('MISS');
    expect(renderCallCard({ ...base, status: 'void' })).toContain('VOID');
  });

  it('escapes a claim rather than letting it close a tag', async () => {
    const { renderCallCard } = await import('./og.js');
    const { htmlToSatori } = await import('./_lib/satori-html.js');
    const html = renderCallCard({
      id: 1,
      countryCode: 'XX',
      claim: '</span><span style="color:red">injected',
      probability: 0.5,
      resolvesOn: '2026-09-05',
      madeOn: '2026-08-22',
      status: 'pending',
    });
    // The claim survives as ESCAPED text. Asserting the absence of the
    // substring "color:red" would be the wrong test — it is present, harmless,
    // inside &quot;…&quot;. The property that matters is that it never becomes
    // an ELEMENT, so assert on the parsed tree, not on the markup.
    expect(html).toContain('&lt;/span&gt;&lt;span style=&quot;color:red&quot;&gt;injected');
    const node = htmlToSatori(html);
    const styles: string[] = [];
    const walk = (n: unknown) => {
      if (typeof n !== 'object' || n === null) return;
      const el = n as { props?: { style?: Record<string, string>; children?: unknown } };
      if (el.props?.style?.color) styles.push(el.props.style.color);
      const kids = el.props?.children;
      if (Array.isArray(kids)) kids.forEach(walk);
    };
    walk(node);
    expect(styles).not.toContain('red');
  });
});

describe('the ledger card never invents a score it does not have', () => {
  it('reports the open book while nothing has resolved', async () => {
    const { renderLedgerCard } = await import('./og.js');
    const html = renderLedgerCard({ open: 42, resolved: 0, hits: 0, nextResolves: '2026-09-05' });
    expect(html).toContain('42');
    expect(html).toContain('NOTHING RESOLVED YET');
    expect(html).toContain('first resolves 2026-09-05');
  });

  it('shows hits over resolved once there is something to show', async () => {
    const { renderLedgerCard } = await import('./og.js');
    const html = renderLedgerCard({ open: 12, resolved: 30, hits: 19, nextResolves: '2026-09-12' });
    expect(html).toContain('19/30');
    expect(html).toContain('CALLS THAT LANDED');
  });

  it('renders a card with no numbers at all when the book cannot be read', async () => {
    const { renderLedgerCard } = await import('./og.js');
    const html = renderLedgerCard(null);
    expect(html).toContain('NOTHING RESOLVED YET');
    expect(html).not.toMatch(/>\d+</);
  });
});
