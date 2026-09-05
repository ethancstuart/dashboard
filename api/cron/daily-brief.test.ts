import { describe, it, expect } from 'vitest';
import {
  buildFallbackText,
  formatResolvedCallLines,
  spliceLedgerLine,
  type ResolvedCallRow,
  renderDossierEmail,
  type BriefData,
} from './daily-brief.js';
import { validateBriefStructure } from '../_lib/brief-structure.js';
import { type, typeStyleAttr } from '../../src/styles/email-tokens.js';

/**
 * The one fixture that must never break: the deterministic fallback is the
 * publish gate's safe harbor, so IT must satisfy the same structural contract
 * the gate enforces on the model. A fallback that fails its own gate's spec
 * means a refused draft has nowhere safe to fall.
 */

const base: BriefData = {
  date: '2026-08-23',
  utcTime: '10:00 UTC',
  topRiskCountries: [
    {
      name: 'Sudan',
      code: 'SD',
      score: 80, // structural level (post-split)
      deviation: 9, // live signal today — what movers rank by
      prevScore: 80,
      prevDeviation: 2,
      components: { conflict: 17, disasters: 3, governance: 8, marketExposure: 4 },
    },
    {
      name: 'Yemen',
      code: 'YE',
      score: 82,
      deviation: 1,
      prevScore: 82,
      prevDeviation: 1,
      components: { conflict: 15, disasters: 2, governance: 7, marketExposure: 3 },
    },
  ] as BriefData['topRiskCountries'],
  totalCountries: 85,
  earthquakeCount: 31,
  significantQuakes: ['M5.1 off Honshu'],
  diseaseCount: 4,
  recentOutbreaks: [],
  conflictHeadlines: [],
  markets: [{ symbol: 'Crude oil ETF (USO)', price: '78.12', change: '+0.8%' }] as BriefData['markets'],
  yesterdayEqCount: 28,
  weeklyTrends: [
    {
      name: 'Sudan',
      code: 'SD',
      scores: [{ date: '2026-08-17', score: 60 }],
      currentScore: 71,
      weekAgoScore: 60,
      direction: 'rising',
    },
  ] as BriefData['weeklyTrends'],
  correlations: [],
  newsHeadlines: [{ title: 'Ceasefire talks stall in Port Sudan', source: 'Reuters' }],
  resolvedCallLines: [],
  openCallLines: [
    'Iran (IR): 62% chance of a confirmed censorship event by 2026-09-05 — +18pts vs its base rate of 44%',
  ],
};

describe('buildFallbackText — the safe harbor honours the structure contract', () => {
  it('passes the daily structure gate with full data', () => {
    const r = validateBriefStructure(buildFallbackText(base), false);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it('passes the gate even with empty feeds and no open calls', () => {
    const empty: BriefData = {
      ...base,
      topRiskCountries: [],
      markets: [],
      newsHeadlines: [],
      weeklyTrends: [],
      resolvedCallLines: [],
      openCallLines: [],
    };
    const text = buildFallbackText(empty);
    expect(validateBriefStructure(text, false).pass).toBe(true);
    expect(text).toContain('No open calls today.');
  });

  it("leads Today's Call with the first (most divergent) open call, verbatim", () => {
    expect(buildFallbackText(base)).toContain(base.openCallLines[0]);
  });

  it('never attributes a driver — every mover line says so explicitly', () => {
    const text = buildFallbackText(base);
    expect(text).toContain("driver not identified in today's data.");
  });
});

/**
 * THE EMAIL IDENTITY MUST ACTUALLY REACH THE PARSER.
 *
 * For 4.5 months every `style="..."` attribute that began with a font stack
 * was truncated at the first quote of `"Tiempos Headline"` / `"Inter"` /
 * `"JetBrains Mono"`, because the three renderers each built the attribute
 * with an UNESCAPED `style="${inline}"`. The parser saw `style="font-family:"`
 * and dropped the colour, size, weight and letter-spacing behind it. Nothing
 * failed: the HTML was still well-formed, just wearing none of the design.
 *
 * These assertions DERIVE over every attribute in a real render rather than
 * listing the ones we happen to know about, so a NEW call site that hardcodes
 * an unescaped attribute fails by default instead of passing by omission.
 */
describe('rendered brief — no style attribute is truncated by an embedded quote', () => {
  /**
   * Split a document into style attributes exactly the way an HTML parser
   * does: a double-quoted attribute value ends at the FIRST `"`. The tell for
   * a truncated attribute is therefore not that the value looks wrong — it is
   * that the character after the closing quote is not a legal attribute
   * boundary (whitespace, `/` or `>`).
   */
  function styleAttrs(html: string): { value: string; nextChar: string; truncated: boolean }[] {
    const needle = 'style="';
    const out: { value: string; nextChar: string; truncated: boolean }[] = [];
    let i = html.indexOf(needle);
    while (i !== -1) {
      const start = i + needle.length;
      const end = html.indexOf('"', start);
      if (end === -1) break;
      const nextChar = html.slice(end + 1, end + 2);
      out.push({
        value: html.slice(start, end),
        nextChar,
        truncated: !(nextChar === '' || /[\s/>]/.test(nextChar)),
      });
      i = html.indexOf(needle, end + 1);
    }
    return out;
  }

  const rendered = renderDossierEmail({
    briefText: buildFallbackText(base),
    date: base.date,
    time: base.utcTime,
    markets: base.markets,
  });

  for (const surface of ['emailHtml', 'beehiivHtml'] as const) {
    it(`${surface}: every style attribute value is free of raw double quotes`, () => {
      const attrs = styleAttrs(rendered[surface]);
      // Guard the guard: if the extractor finds nothing, it is broken, and a
      // vacuous pass would be indistinguishable from a real one.
      expect(attrs.length).toBeGreaterThan(20);

      const truncated = attrs.filter((a) => a.truncated);
      expect(truncated.map((a) => `${JSON.stringify(a.value)} → next char ${JSON.stringify(a.nextChar)}`)).toEqual([]);

      for (const a of attrs) expect(a.value).not.toContain('"');
    });
  }

  it('emailHtml: the masthead keeps its whole declaration list, not just font-family', () => {
    // The positive half. A style attribute that survives the scan above could
    // still be empty; this asserts the identity is actually present.
    const attrs = styleAttrs(rendered.emailHtml).map((a) => a.value);
    const masthead = attrs.find((v) => v.includes('Tiempos Headline') && v.includes('28px'));
    expect(masthead, 'no masthead style attribute carrying the serif stack at 28px').toBeDefined();
    expect(masthead).toContain('font-weight:700');
    expect(masthead).toContain('color:');
  });

  it('no style attribute anywhere ends mid-declaration on a dangling colon', () => {
    for (const surface of ['emailHtml', 'beehiivHtml'] as const) {
      for (const a of styleAttrs(rendered[surface])) {
        expect(a.value, `${surface} has a declaration cut off at its colon`).not.toMatch(/:\s*$/);
      }
    }
  });
});

/**
 * The two other renderers (api/send-alert-email.ts, api/subscribe.ts — the
 * WELCOME email) are request handlers and cannot be rendered without a live
 * request, DB and Resend key. They are covered structurally instead: all three
 * files now build their attributes through the one shared helper, so asserting
 * the helper is correct for EVERY typography token covers them by construction.
 * A new token whose font stack contains a quote is covered automatically.
 */
describe('typeStyleAttr — the one shared helper is safe for every token', () => {
  for (const [name, token] of Object.entries(type)) {
    it(`${name} produces a well-formed, non-truncated style attribute`, () => {
      const attr = typeStyleAttr(token, { color: '#12161C' });
      expect(attr.startsWith('style="')).toBe(true);
      expect(attr.endsWith('"')).toBe(true);
      // The value is everything between the delimiters; it must contain no
      // raw quote of its own, or the attribute ends early.
      const value = attr.slice('style="'.length, -1);
      expect(value).not.toContain('"');
      // And the declaration list must have survived past the font family.
      expect(value).toContain('font-size:');
      expect(value).toContain('color:#12161C');
    });
  }
});

describe('resolution day is first-class', () => {
  /**
   * All of this exists because of 2026-09-05: 39 calls settled for the first
   * time and the brief led with an unrelated FX call, because the model's
   * context selected only status='pending' and the fallback read only
   * openCallLines. These tests pin the repaired behaviour on both paths.
   */
  const resolvedDay: BriefData = {
    ...base,
    resolvedCallLines: [
      '34 calls settled against external ground truth: 10 hit, 24 miss. 5 due calls remain pending under the coverage-grace rule (thin evidence, never scored as a miss).',
      'Kazakhstan (KZ): HIT — we said 16% (base rate 10%) for a confirmed censorship event by 2026-09-05 — OONI confirmed blocking on 2 days in the window',
    ],
  };

  it('the fallback leads with the record, then the open call', () => {
    const text = buildFallbackText(resolvedDay);
    const agg = text.indexOf('34 calls settled');
    const detail = text.indexOf('Kazakhstan (KZ): HIT');
    const open = text.indexOf(base.openCallLines[0]);
    expect(agg).toBeGreaterThan(-1);
    expect(detail).toBeGreaterThan(agg);
    expect(open).toBeGreaterThan(detail);
    // And it still satisfies the gate that would otherwise refuse it.
    expect(validateBriefStructure(text, false).pass).toBe(true);
  });

  it('with no resolutions the fallback is byte-identical to before', () => {
    expect(buildFallbackText(base)).not.toContain('settled against external ground truth');
  });
});

describe('formatResolvedCallLines', () => {
  const row = (over: Partial<ResolvedCallRow>): ResolvedCallRow => ({
    kind: 'censorship_event',
    country_code: 'KZ',
    probability: 0.16,
    base_rate: 0.1,
    status: 'hit',
    resolves_on: '2026-09-05',
    evidence_count: 2,
    ...over,
  });

  it('leads with the aggregate, orders detail by divergence', () => {
    const lines = formatResolvedCallLines(
      [
        row({ country_code: 'TR', probability: 0.84, base_rate: 0.9 }), // div .06
        row({ country_code: 'KZ', probability: 0.16, base_rate: 0.1 }), // div .06
        row({ country_code: 'UZ', probability: 0.52, base_rate: 0.7, status: 'miss', evidence_count: 0 }), // div .18 — first
      ],
      0,
      undefined,
      { total: 3, hits: 2 },
    );
    expect(lines[0]).toContain('3 calls settled');
    expect(lines[0]).toContain('2 hit, 1 miss');
    expect(lines[1]).toContain('UZ');
    expect(lines[1]).toContain('MISS');
  });

  it('the aggregate comes from totals, NEVER from the page of rows', () => {
    // rows is a divergence-ordered PAGE. A 105-resolution morning fetches 40
    // rows; publishing rows.length as the count is the by_kind page-size
    // defect (2026-08-30) reborn. Caught by the rule-2 review.
    const page = Array.from({ length: 40 }, (_, i) => row({ country_code: `C${i}`, probability: 0.5, base_rate: 0.4 }));
    const lines = formatResolvedCallLines(page, 0, undefined, { total: 105, hits: 18 });
    expect(lines[0]).toContain('105 calls settled');
    expect(lines[0]).toContain('18 hit, 87 miss');
    expect(lines.at(-1)).toContain('and 93 more'); // 105 - 12 shown
  });

  it('caps the detail list and says so', () => {
    const many = Array.from({ length: 30 }, (_, i) => row({ country_code: `C${i}`, probability: 0.5, base_rate: 0.4 }));
    const lines = formatResolvedCallLines(many, 0, undefined, { total: 30, hits: 30 });
    expect(lines.length).toBe(1 + 12 + 1);
    expect(lines.at(-1)).toContain('and 18 more');
  });

  it('an unknown kind is NEVER described as a censorship event', () => {
    // The first version's else-branch phrased any non-FX kind as "a confirmed
    // censorship event" — a false public claim for a future kind, by
    // omission. Unknown kinds get wording true of every call by construction.
    const lines = formatResolvedCallLines([row({ kind: 'sanctions_designation', country_code: 'RU' })], 0, undefined, {
      total: 1,
      hits: 1,
    });
    expect(lines[1]).not.toContain('censorship');
    expect(lines[1]).toContain('declared external source');
  });

  it('speaks when calls are due but NONE resolved — the silent-resolver case', () => {
    const lines = formatResolvedCallLines([], 5, undefined, { total: 0, hits: 0 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('5 calls came due and none has resolved yet');
    expect(lines[0]).toContain('coverage-grace');
  });

  it('is empty when there is genuinely nothing to say', () => {
    expect(formatResolvedCallLines([], 0, undefined, { total: 0, hits: 0 })).toEqual([]);
  });

  it('phrases FX and censorship claims differently, and only censorship hits carry evidence days', () => {
    const lines = formatResolvedCallLines(
      [
        row({ kind: 'fx_devaluation', country_code: 'SE', status: 'miss', evidence_count: null }),
        row({ country_code: 'IN', probability: 0.84, base_rate: 0.9, evidence_count: 14 }),
      ],
      0,
      undefined,
      { total: 2, hits: 1 },
    );
    const fx = lines.find((l) => l.includes('SE'))!;
    const oo = lines.find((l) => l.includes('IN'))!;
    expect(fx).toContain('currency depreciation');
    expect(fx).not.toContain('OONI');
    expect(oo).toContain('OONI confirmed blocking on 14 days');
  });
});

describe('spliceLedgerLine', () => {
  /**
   * The old splice put "> **The Ledger**" at line 0. No renderer handles ">",
   * and parseSections turns any preamble into a titleless pseudo-section — so
   * the first resolution day shipped mis-rendered on all three surfaces.
   */
  const body = "## 🎯 Today's Call\n\nA call.\n\n## 📊 Top Signal\n\nSignal.";

  it('splices INSIDE the first section, never as a preamble', () => {
    const out = spliceLedgerLine(body, '34 resolved today, 10 hit');
    expect(out.startsWith('## ')).toBe(true); // nothing before the first header
    const lines = out.split('\n');
    expect(lines[0]).toBe("## 🎯 Today's Call");
    expect(lines[2]).toBe('**The Ledger** — 34 resolved today, 10 hit');
  });

  it('emits no blockquote — the character no renderer parses', () => {
    expect(spliceLedgerLine(body, 'x')).not.toContain('\n> ');
  });

  it('still satisfies the structure gate', () => {
    const full = buildFallbackText(base);
    expect(validateBriefStructure(spliceLedgerLine(full, '1 open'), false).pass).toBe(true);
  });

  it('appends rather than losing the line when no header exists', () => {
    expect(spliceLedgerLine('plain text', 'the line')).toContain('**The Ledger** — the line');
  });
});
