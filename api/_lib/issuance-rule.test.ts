import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canDepartFromBaseRate, shouldIssue, RECENCY_WEIGHT, CALIBRATION_KINDS, type CallKind } from './calls.js';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * STATE A CLAIM, OR BE A CONTROL. Nothing else is issued.
 *
 * A generator with a recency weight of zero returns `longRun` unchanged, and
 * the recorder stores that same value as `base_rate`. Probability and baseline
 * are then bit-identical, `brierSkillScore` divides a sum by itself, and skill
 * is exactly 0.000 for any outcome sequence. Such a generator publishes
 * climatology and grades it against itself.
 *
 * Censorship has been in that state since 2026-08-23 — correctly, because a
 * walk-forward backtest measured recency at -7.1% skill there. The tuning was
 * right; continuing to ISSUE under it was not.
 *
 * The calibration harness is the one kind for which zero skill is the intended
 * reading, so it keeps issuing. That is not an exception carved out for an
 * awkward case: it is already declared in CALIBRATION_KINDS, and the harness's
 * whole purpose is to prove the scoring machinery is honest on a domain where
 * the right answer is computable.
 */
describe('issuance rule', () => {
  it('a climatology generator cannot depart from its base rate', () => {
    expect(canDepartFromBaseRate('censorship_event')).toBe(false);
    expect(canDepartFromBaseRate('seismicity_window')).toBe(false);
    expect(canDepartFromBaseRate('fx_devaluation')).toBe(true);
  });

  it('censorship stops issuing; FX continues; the harness continues', () => {
    expect(shouldIssue('censorship_event'), 'every call would score 0.000 by algebra').toBe(false);
    expect(shouldIssue('fx_devaluation'), 'FX still states a claim').toBe(true);
    expect(shouldIssue('seismicity_window'), 'the harness exists to sit at climatology').toBe(true);
  });

  /**
   * THE DERIVED FORM. Not a list of today's three kinds: every kind declared in
   * RECENCY_WEIGHT is checked against the rule, so a NEW kind added with a zero
   * weight is caught without anyone editing this test.
   */
  it('holds for every declared kind, including ones not yet written', () => {
    const kinds = Object.keys(RECENCY_WEIGHT) as CallKind[];
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      const expected = RECENCY_WEIGHT[kind] !== 0 || CALIBRATION_KINDS.has(kind);
      expect(shouldIssue(kind), `${kind} (weight ${RECENCY_WEIGHT[kind]})`).toBe(expected);
    }
  });

  it('the recorder actually consults the rule, rather than merely importing it', () => {
    // A rule nothing calls is a comment. This is the same reason the repo
    // distinguishes a check from a log line.
    const recorder = readFileSync(join(API, 'cron/record-calls.ts'), 'utf8');
    expect(recorder).toContain('shouldIssue(KIND)');
    expect(recorder).toMatch(/issuing \? rows : \[\]/);
  });

  it('the retirement is PUBLISHED, not merely enacted', () => {
    // The whole point of the sequencing. A book that quietly stops growing,
    // with the explanation added later, is indistinguishable from one that
    // stopped because someone disliked where it was heading.
    const ledger = readFileSync(join(API, 'ledger.ts'), 'utf8');
    expect(ledger).toContain('A retired generator');
    expect(ledger).toMatch(/State a claim, or be a control/);
    // The measured reason must survive editing, not just the conclusion.
    expect(ledger, 'the -7.1% measurement is the justification').toMatch(/7\.1% skill/);
    // And the promise that the existing book is untouched.
    expect(ledger).toMatch(/resolve as made/);
  });

  it('the calls already on the book are untouched by this', () => {
    // The recorder gate stops ADDING rows. Nothing here deletes, voids or
    // re-prices what was already issued — those were made, and they resolve as
    // made. If this ever changes, it is a goalpost move.
    const recorder = readFileSync(join(API, 'cron/record-calls.ts'), 'utf8');
    expect(recorder).not.toMatch(/DELETE FROM calls/i);
    expect(recorder).toMatch(/are NOT touched/);
  });
});
