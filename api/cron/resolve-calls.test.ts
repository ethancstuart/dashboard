import { describe, it, expect } from 'vitest';
import { fxEvidenceBasisPoints } from './resolve-calls.js';

/**
 * 2026-09-06, resolution day two: the resolver wrote the FX move as a decimal
 * ("1.12") into evidence_count, an INTEGER column. 63 of 66 FX calls threw
 * `invalid input syntax for type integer` at the UPDATE, were left pending by
 * the per-call isolation, counted in an `errored` field nobody reads, and the
 * run reported ok:true. The three that resolved were the ones whose move
 * rounded whole — the failure was invisible precisely where it mattered.
 *
 * Evidence is now stored in BASIS POINTS: integral by construction, so no
 * value this function returns can ever meet the column wrongly again.
 *
 * This file itself has a scar: its first version was EMPTY — a `>>` heredoc
 * created a zero-byte file and the `||` guard then skipped the real write —
 * and an ungated `;` between validate and commit let a commit claim tests it
 * never ran. Both were caught one commit later; the claim is corrected there.
 */
describe('fxEvidenceBasisPoints', () => {
  it('is integral for exactly the values that threw in production', () => {
    for (const moved of [1.12, 0.18, 0.95, 0.005, 2.375, 19.99]) {
      expect(Number.isInteger(fxEvidenceBasisPoints(moved))).toBe(true);
    }
  });

  it('is exact where percent-storage was lossy', () => {
    expect(fxEvidenceBasisPoints(1.12)).toBe(112);
    expect(fxEvidenceBasisPoints(0.18)).toBe(18);
    expect(fxEvidenceBasisPoints(0)).toBe(0);
  });

  it('rounds sub-basis-point noise instead of throwing it at the column', () => {
    expect(fxEvidenceBasisPoints(0.005)).toBe(1);
    expect(fxEvidenceBasisPoints(0.004)).toBe(0);
  });

  it('handles a negative move (appreciation) without going fractional', () => {
    expect(fxEvidenceBasisPoints(-0.37)).toBe(-37);
    expect(Number.isInteger(fxEvidenceBasisPoints(-1.115))).toBe(true);
  });
});
