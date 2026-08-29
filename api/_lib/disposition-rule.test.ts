import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * THE DISPOSITION RULE MUST BE PUBLISHED BEFORE IT IS APPLIED.
 *
 * From 2026-09-05 a censorship call with too little resolver coverage is marked
 * `unresolvable` and leaves the scored set. Eight of the thirty-nine calls
 * resolving that day are projected to go that way.
 *
 * Published beforehand, that is methodology. Published afterwards — or not at
 * all — eight calls simply vanish from the numbers, and from outside that is
 * indistinguishable from dropping the ones we expected to lose. The rule is
 * therefore load-bearing COPY, not decoration, and it lives on /ledger rather
 * than /methodology because /methodology is client-rendered: a crawler and a
 * skim-reader never see it.
 *
 * These assertions guard against silent removal. They cannot prove the page
 * renders — that is verified by fetching the deployed page and reading it.
 */
describe('the unresolvable disposition rule is published on /ledger', () => {
  const ledger = readFileSync(join(API, 'ledger.ts'), 'utf8');

  it('states the rule, the asymmetry, and the void distinction', () => {
    expect(ledger, 'the rule heading is missing').toContain('When we cannot score a call');
    // The asymmetry is the part most likely to be trimmed for length, and the
    // part that stops the gate reading as "we withhold what we dislike".
    expect(ledger, 'the observed-block asymmetry is missing').toMatch(/no matter how thin the coverage/);
    // void = our defect; unresolvable = the world's silence. Losing this
    // distinction makes both look like the same excuse.
    expect(ledger).toMatch(/Unresolvable is not the same as void/);
    expect(ledger).toMatch(/rule published\s*'?\s*\+?\s*'?\s*afterwards is not a rule/);
  });

  it('the projected count is COMPUTED, never written as a literal', () => {
    // A number typed into prose is true on the day it is typed and wrong
    // afterwards — the delayed-fuse class this project already has a rule
    // about. The window for the next cohort is still filling, so the figure
    // must come from the data on every render.
    expect(ledger).toContain('dueProjection');
    expect(ledger).toContain('coverageRequirement(r.horizon_days)');
    // And it must fall back to NO claim rather than a stale one.
    expect(ledger).toMatch(/No claim rather than a stale one/);
  });

  it('a call with an observed block is excluded from the projection', () => {
    // If this inverts, the page would claim we are withholding calls we are in
    // fact about to score as hits.
    expect(ledger).toMatch(/if \(r\.blocked_days >= 1\) return false/);
  });
});
