import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * THE PRE-PUSH HOOK COVERS THE PROJECT'S DECLARED VALIDATION SURFACE.
 *
 * `.githooks/pre-push` derives its guard list from every `check:*` script in
 * package.json, which means a new *check:* guard is enforced the moment it is
 * defined. An independent review pointed out the remaining hole: a new required
 * guard named something ELSE — `verify:x`, `audit:y` — would pass by omission,
 * because `npm run validate` is the project's actual declaration of what must
 * pass and the hook does not read it.
 *
 * The obvious fix — run `validate` in the hook — is wrong, and measurably so.
 * On 2026-08-29 `npm run validate` FAILS in a clean worktree: its `format:check`
 * runs tree-wide and trips on untracked scratch another process leaves behind.
 * Wiring it in would block every push on files the pusher never touched, which
 * is exactly what the delta-scoped prettier in the hook exists to prevent.
 *
 * So the coverage is asserted HERE instead, and the hook runs this suite. A new
 * step added to `validate` that the hook does not cover fails the tests, which
 * fails the push. Derived from `validate` itself, at no cost to hook latency.
 *
 * Steps deliberately not run by the hook must be named below WITH THEIR REASON.
 * That list is an exception register, not a scope definition: anything absent
 * from it fails by default.
 */
const COVERED_DIFFERENTLY: Record<string, string> = {
  // The hook runs prettier scoped to the PUSHED DELTA instead, on purpose:
  // untracked scratch from parallel sessions must not block a push it is not
  // part of. This is the specific reason `validate` cannot be run wholesale.
  'format:check': 'hook runs prettier --check on the pushed delta only',
  // eslint over the whole repo is slow enough to make people skip the hook,
  // and it is enforced in CI where latency does not change behaviour.
  lint: 'enforced in CI; too slow for a pre-push gate',
};

function scriptsIn(validateLine: string): string[] {
  // `npm run a && npm run b && ...` -> [a, b, ...]
  return [...validateLine.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
}

describe('pre-push hook covers npm run validate', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const hook = readFileSync(join(ROOT, '.githooks/pre-push'), 'utf8');

  it('validate is still the declared validation surface', () => {
    // If this disappears or is renamed, the assertion below would silently
    // cover nothing — a green result with no mechanism behind it.
    expect(typeof pkg.scripts.validate).toBe('string');
    expect(scriptsIn(pkg.scripts.validate).length).toBeGreaterThan(3);
  });

  it('every step of validate is run by the hook, or excused with a reason', () => {
    const steps = scriptsIn(pkg.scripts.validate);
    const uncovered: string[] = [];

    for (const step of steps) {
      if (step in COVERED_DIFFERENTLY) continue;
      // Either named outright in the hook, or picked up by its derived
      // `check:*` loop.
      const namedInHook = hook.includes(`npm run ${step}`) || hook.includes(`npm run "${step}"`);
      const derivedByLoop = step.startsWith('check:') && hook.includes("indexOf('check:')");
      if (!namedInHook && !derivedByLoop) uncovered.push(step);
    }

    expect(uncovered).toEqual([]);
  });

  it('the derived loop is actually present, not just the checks it happens to cover', () => {
    // Guards the guard: if someone replaces the loop with a hard-coded list,
    // the test above could still pass on today's scripts while the derivation
    // property is gone.
    expect(hook).toContain("indexOf('check:')");
    expect(hook).toContain('for c in $CHECKS');
    expect(hook).toContain('EMPTY guard list');
  });

  it('every excused step is real, so the exception list cannot rot', () => {
    // An exception for a step that no longer exists is dead weight that hides
    // whether the register is still accurate.
    for (const step of Object.keys(COVERED_DIFFERENTLY)) {
      expect(pkg.scripts, `${step} is excused but no longer exists`).toHaveProperty(step);
    }
  });
});
