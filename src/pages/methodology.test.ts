import { describe, it, expect, beforeEach } from 'vitest';
import { renderMethodology } from './methodology.ts';
import { MIN_MEASUREMENTS_PER_REQUIRED_DAY, coverageRequirement } from '../../api/_lib/calls.ts';

/**
 * The coverage rule governs live, irreversible public verdicts, so the page
 * that publishes it must not be able to state a threshold the resolver is not
 * using. The previous wording could, and did: it described a boolean
 * "no coverage" gate for weeks after the resolver had become two-dimensional.
 *
 * These assertions are DERIVED — they compare the rendered page against the
 * resolver's own module, never against a literal. Retyping 350 here would
 * reproduce exactly the defect the test exists to prevent, because the test
 * and the page would then drift together.
 *
 * Plant-tested 2026-08-30 both ways: with MIN_MEASUREMENTS_PER_REQUIRED_DAY
 * temporarily moved to 60 the rendered page followed to 420 and the suite
 * stayed green (proving derivation, not agreement-by-coincidence); with the
 * interpolation replaced by a hardcoded 350 the suite went RED.
 */
describe('methodology publishes the coverage rule the resolver actually runs', () => {
  let root: HTMLElement;
  let text: string;

  beforeEach(() => {
    root = document.createElement('div');
    renderMethodology(root);
    // Collapse whitespace: the HTML wraps mid-sentence, so an in-context
    // assertion has to see the sentence the reader sees, not the source layout.
    text = (root.textContent ?? '').replace(/\s+/g, ' ');
  });

  it('states the per-day measurement floor from the resolver module', () => {
    // IN CONTEXT, not as a bare substring. A plant test caught this assertion
    // passing on a page that stated 50 while the module said 60, because "60"
    // also appears in the CII band table further down. A number that can be
    // satisfied by any occurrence anywhere on the page asserts nothing.
    expect(text).toContain(`${MIN_MEASUREMENTS_PER_REQUIRED_DAY} measurements per required day`);
  });

  it('states both bars for a fourteen-day call, derived not retyped', () => {
    const req = coverageRequirement(14);
    expect(text).toContain(`is ${req.minDays} days`);
    expect(text).toContain(`${req.minMeasurements} measurements across a fourteen-day call`);
  });

  it('does not describe the retired boolean gate', () => {
    // The old text scored on "no coverage"/"zero measurements", which certified
    // a country on a single probe-day. SD and SS would have published as misses.
    expect(text).not.toMatch(/no coverage for that country/i);
    expect(text).not.toMatch(/not zero events, but zero measurements/i);
  });

  it('records the asymmetry: a confirmed block is a hit regardless of coverage', () => {
    expect(text).toMatch(/no matter how thin the coverage/i);
  });

  it('does not hardcode a count of unresolvable calls, which decays', () => {
    // "Three of the calls resolving on 5 September" was true when typed and
    // wrong within two days. The live count belongs on the Ledger.
    expect(text).not.toMatch(/\b(three|four|five|six|seven|eight|nine)\s+of\s+the\s+calls\s+resolving/i);
  });
});
