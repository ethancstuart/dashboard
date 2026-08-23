import { describe, it, expect } from 'vitest';
import { extractNumerals, groundDraft } from './grounding.js';

describe('extractNumerals', () => {
  it('reads plain, comma-grouped, decimal, percent, currency and plus-suffixed forms', () => {
    expect(extractNumerals('2,136 blocks, up 15%, oil $134.54, 400+ dead, CII 61')).toEqual([
      2136, 15, 134.54, 400, 61,
    ]);
  });

  it('ignores words and empty text', () => {
    expect(extractNumerals('no numbers here')).toEqual([]);
  });
});

describe('groundDraft — the fabrications it exists to catch', () => {
  const context = [
    '=== CII === Sudan: 61/100 (prev 52) [conflict=17]',
    '=== OONI === Russia: 2,136 confirmed blocking measurements, Iran: 1,611',
    '=== MARKETS === Crude oil ETF (USO): 134.54 (+2.77%)',
  ].join('\n');

  it('passes a draft whose numbers all come from the context', () => {
    const draft =
      'Sudan moved to 61 from 52. OONI recorded 2,136 confirmed blocks in Russia and 1,611 in Iran. USO closed at 134.54, up 2.77%.';
    const r = groundDraft(draft, context);
    expect(r.unsupported).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it('accepts arithmetic derivations — "jumped 9" from 52 and 61', () => {
    const r = groundDraft('Sudan jumped 9 points overnight to 61.', context);
    expect(r.unsupported).toEqual([]);
  });

  it('accepts true roundings in both directions, rejects a number near nothing', () => {
    expect(groundDraft('USO near 134.', context).unsupported).toEqual([]); // truncation of 134.54
    expect(groundDraft('USO near 135.', context).unsupported).toEqual([]); // rounding of 134.54
    expect(groundDraft('USO near 140.', context).unsupported).toEqual([140]);
  });

  it('FLAGS the published fabrication class: invented casualty figures', () => {
    const r = groundDraft(
      'ACLED reports 400+ civilian casualties in the last week. Separately, 8,300 displaced and a 45% surge in attacks near the 380 corridor.',
      context,
    );
    expect(r.unsupported).toEqual([400, 8300, 45, 380]);
    expect(r.pass).toBe(false);
  });

  it('FLAGS the hardcoded false precedent: "oil spiked 15% in 48h"', () => {
    const r = groundDraft('In the 2019 tanker attacks, oil spiked 15% in 48h and shipping rates rose 210%.', context);
    // 2019 (a year) and 48 (an hour window) are structurally exempt — the
    // no-self-history prompt rule owns bare years; the invented FIGURES are
    // what this gate exists for.
    expect(r.unsupported).toEqual([15, 210]);
  });

  it('does not punish structural counting numbers, years, or hour windows', () => {
    const r = groundDraft('Three things to watch over the next 72 hours, and one for 2027.', context);
    expect(r.unsupported).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it('one stray number in a well-grounded brief does not fail the gate', () => {
    const draft =
      'Sudan at 61 (prev 52). Russia 2,136 blocks, Iran 1,611. USO 134.54 (+2.77%). Volumes near 87 held steady.';
    const r = groundDraft(draft, context);
    expect(r.unsupported).toEqual([87]);
    expect(r.pass).toBe(true); // 1 of 7, under both thresholds
  });

  it('a numeral-free draft passes with rate 0', () => {
    const r = groundDraft('A quiet day. Nothing moved that the data can explain.', context);
    expect(r.unsupportedRate).toBe(0);
    expect(r.pass).toBe(true);
  });
});
