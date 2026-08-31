import { describe, it, expect } from 'vitest';
import { specifiersIn, stripComments } from './check-client-safe-imports.ts';

const find = (src: string) => specifiersIn(stripComments(src));

/**
 * REGRESSION TESTS FOR A GUARD THAT REPORTED GREEN WHILE BLIND.
 *
 * The first version of this guard matched an import clause with `[^'"\n]*?`,
 * which cannot cross a newline. Prettier wraps any import with more than a
 * couple of named specifiers, so the ordinary formatting of this repo was
 * invisible to it. Planted and confirmed 2026-08-30: with only a multiline
 * `import { … } from '../../api/_lib/calls.ts'` reaching a module that
 * imported `@neondatabase/serverless`, the guard printed
 * "OK — no src/ module imports from api/" and exited 0.
 *
 * All three of the original plant tests used single-line imports. That is how
 * a blind spot survives its own test suite, and it is why the extractor is
 * tested directly here rather than only through the guard's exit code.
 */
describe('import extraction sees every form a bundler would follow', () => {
  it('finds a MULTILINE import — the form that reported green', () => {
    expect(
      find(`import {
  MIN_MEASUREMENTS_PER_REQUIRED_DAY,
  coverageRequirement,
} from '../../api/_lib/calls.ts';`),
    ).toEqual(['../../api/_lib/calls.ts']);
  });

  it('finds single-line, default, namespace and re-export forms', () => {
    expect(find(`import { a } from 'x';`)).toEqual(['x']);
    expect(find(`import a from 'x';`)).toEqual(['x']);
    expect(find(`import * as a from 'x';`)).toEqual(['x']);
    expect(find(`export { a } from 'x';`)).toEqual(['x']);
    expect(find(`export * from 'x';`)).toEqual(['x']);
  });

  it('finds side-effect and dynamic imports', () => {
    expect(find(`import 'x';`)).toEqual(['x']);
    expect(find(`const m = await import('x');`)).toEqual(['x']);
  });

  it('finds several imports in one file without merging them', () => {
    expect(
      find(`import { a } from 'x';
import {
  b,
} from 'y';
import c from 'z';`),
    ).toEqual(['x', 'y', 'z']);
  });

  it('SKIPS statement-level type-only imports, which are erased', () => {
    // Rejecting these would fire on genuinely safe code. A guard that cries
    // wolf is a guard people bypass.
    expect(find(`import type { A } from 'pkg';`)).toEqual([]);
    expect(find(`export type { A } from 'pkg';`)).toEqual([]);
  });

  it('does NOT skip inline type specifiers, which still emit a runtime import', () => {
    expect(find(`import { type A, b } from 'pkg';`)).toEqual(['pkg']);
  });

  it('ignores imports inside comments — this repo documents its own markers', () => {
    // The guard's own docstring names `@neondatabase/serverless` as the
    // example of what it forbids. Reading that as a real import would make the
    // guard fail on itself.
    expect(find(`// import { neon } from '@neondatabase/serverless';`)).toEqual([]);
    expect(find(`/* import { neon } from '@neondatabase/serverless'; */`)).toEqual([]);
    expect(find(`/**\n * import x from 'pkg';\n */\nimport { real } from 'y';`)).toEqual(['y']);
  });

  it('does not let a bounded clause swallow the file', () => {
    // The clause pattern refuses to cross a `;` or another import keyword, so
    // two statements cannot be merged into one spurious match.
    const out = find(`import { a } from 'first';\nconst s = "noise";\nimport { b } from 'second';`);
    expect(out).toEqual(['first', 'second']);
  });
});
