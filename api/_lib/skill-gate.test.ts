import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishableSkill, informativeRows, MIN_RESOLUTION_BATCHES, type ScoredCall } from './calls.js';

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The one module allowed to touch the raw, ungated arithmetic. */
const OWNER = 'api/_lib/calls.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/**
 * THE STRUCTURAL GATE.
 *
 * On 2026-08-28 four places computed a skill score. Two carried their own copy
 * of the batch gate and two carried none — and one of the ungated pair was the
 * daily brief, which would have published a pooled cross-kind number from a
 * single resolution batch on 2026-09-05, a number both ledger surfaces
 * correctly withheld.
 *
 * A shared helper would not have fixed that, because a fifth caller could still
 * reach the raw function. So the raw function is confined to its own module and
 * this test enforces the confinement. A new caller cannot forget the gate,
 * because the only reachable path already has it.
 *
 * Derived, not enumerated: this scans for the property (who calls the raw
 * function) rather than listing the files someone remembered to check, so a NEW
 * file fails by default rather than passing by omission.
 */
describe('the skill gate is structural, not remembered', () => {
  it('nothing outside its own module calls the ungated brierSkillScore', () => {
    const offenders: string[] = [];
    let scanned = 0;

    for (const file of walk(API_DIR)) {
      const rel = `api/${relative(API_DIR, file)}`;
      if (rel === OWNER) continue;
      scanned++;
      const src = readFileSync(file, 'utf8');
      // Strip comments so prose ABOUT the function does not trip the guard —
      // this file's own history is full of it.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // Calls AND imports. An import without a call is harmless today and is
      // one edit away from not being, so it fails here too.
      if (/\bbrierSkillScore\s*\(/.test(code)) offenders.push(`${rel} (calls it)`);
      else if (/\bbrierSkillScore\b/.test(code)) offenders.push(`${rel} (imports it)`);
    }

    // A scan that silently matches nothing is a green result with no mechanism
    // behind it.
    expect(scanned).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it('formatLedgerLine stays deleted', () => {
    // It printed an ungated pooled skill number beside a raw hit count and had
    // no production caller. Re-adding it would restore a second path to the
    // claim the ledger withholds.
    const src = readFileSync(join(API_DIR, '_lib/calls.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/export function formatLedgerLine/.test(code)).toBe(false);
  });
});

describe('publishableSkill', () => {
  const c = (probability: number, outcome: 0 | 1, baseRate?: number): ScoredCall => ({
    probability,
    outcome,
    baseRate,
  });

  it('withholds below the batch threshold, however many rows there are', () => {
    const many = Array.from({ length: 500 }, (_, i) => c(0.9, (i % 2) as 0 | 1, 0.5));
    expect(Number.isNaN(publishableSkill({ calls: many, batches: MIN_RESOLUTION_BATCHES - 1 }))).toBe(true);
  });

  it('publishes once the batches exist, negative included', () => {
    const s = publishableSkill({
      calls: [c(0.9, 0, 0.5), c(0.1, 1, 0.5)],
      batches: MIN_RESOLUTION_BATCHES,
    });
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeLessThan(0);
  });

  it('refuses a cohort stated entirely at its own base rate', () => {
    // Skill would be exactly 0.000 by algebra — numerator and denominator are
    // the same sum. This is the live state of every censorship call issued from
    // 2026-08-23, and a hard zero printed as a result reads as a measurement.
    const climatology = [c(0.1, 0, 0.1), c(0.9, 1, 0.9), c(0.1, 0, 0.1)];
    expect(Number.isNaN(publishableSkill({ calls: climatology, batches: 5 }))).toBe(true);
    expect(informativeRows(climatology)).toBe(0);
  });

  it('still publishes when only SOME rows sit at their base rate', () => {
    const mixed = [c(0.1, 0, 0.1), c(0.84, 0, 0.9), c(0.2, 1, 0.1)];
    expect(informativeRows(mixed)).toBe(2);
    expect(Number.isFinite(publishableSkill({ calls: mixed, batches: 5 }))).toBe(true);
  });

  it('withholds on an empty cohort rather than returning a number', () => {
    expect(Number.isNaN(publishableSkill({ calls: [], batches: 99 }))).toBe(true);
  });
});
