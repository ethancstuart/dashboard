import { describe, it, expect } from 'vitest';
import { buildFallbackText, renderDossierEmail, type BriefData } from './daily-brief.js';
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
