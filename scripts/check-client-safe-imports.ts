/**
 * Any api/ module the CLIENT can reach must depend on no packages at all.
 *
 * WHY THIS EXISTS. `/methodology` publishes the coverage thresholds that
 * govern live, irreversible public verdicts. It used to state them as prose,
 * and drifted: for two days the page described a retired BOOLEAN gate while
 * the resolver had already become two-dimensional. The fix was to import
 * `MIN_MEASUREMENTS_PER_REQUIRED_DAY` and `coverageRequirement` from
 * `api/_lib/calls.ts` — the same module `resolve-calls` runs on — so the page
 * cannot state a threshold the resolver is not using.
 *
 * An independent review (rule 2) named the cost of that: the public renderer
 * now depends on an api/ module being browser-bundle-safe, and NOTHING
 * ENFORCED IT. `api/_lib/calls.ts` happens to import nothing today. One
 * `import { neon } from '@neondatabase/serverless'` added to it for an
 * unrelated reason would pull a server package into the client bundle.
 *
 * That reviewer was right that the dependency is real, and wrong that the
 * answer is to go back to retyping the numbers — retyping is what produced
 * the original defect. The answer is to make the boundary a PROVEN PROPERTY
 * rather than an assumption. This guard is that proof.
 *
 * THE DERIVATION IS THE POINT (rule 5). The protected set is not a list of
 * "the api files the client uses". It is computed: every import in `src/`
 * that resolves under `api/`, then the transitive closure of THAT module's
 * own imports. So a NEW src -> api import is in scope the moment it is
 * written, and a new dependency added to an already-reachable api module
 * fails by default rather than passing by omission.
 *
 * WHAT IT FORBIDS: a bare (package) specifier anywhere in the reachable set —
 * `@neondatabase/serverless`, `@vercel/node`, `node:fs`. Relative imports
 * inside api/ are followed, not rejected.
 *
 * WHY NOT JUST LET THE BUILD CATCH IT: it mostly would, loudly, but only
 * after the change is written and only for packages that actually break in a
 * browser. A browser-safe-but-server-shaped dependency (a module holding a
 * key, a heavy SDK) would ship silently. This states the rule where the
 * reader is, and fails on the property rather than on the symptom.
 *
 * Usage: npx tsx scripts/check-client-safe-imports.ts
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const API = join(ROOT, 'api');

/**
 * Strip comments before looking for imports.
 *
 * Two reasons, and the second is the one that bites. A commented-out import is
 * not an import. And THIS repo documents its own markers — a guard's docstring
 * that says `import { neon } from '@neondatabase/serverless'` as an EXAMPLE
 * would otherwise be read as the thing it warns about. The governance file
 * already carries a scar from a regex matching prose that mentioned the tag it
 * was matching.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Every module specifier a bundler would follow, and the type-only ones it
 * would not.
 *
 * THE FIRST VERSION OF THIS WAS BROKEN AND REPORTED GREEN. It matched the
 * import clause with `[^'"\n]*?`, which cannot cross a newline, so a
 * prettier-wrapped multiline import — the normal formatting for more than one
 * named specifier in this repo — was invisible. An independent review named
 * it; a plant then confirmed it, and the guard printed
 * "OK — no src/ module imports from api/" while a multiline import reached a
 * module that imported `@neondatabase/serverless`. All three of the original
 * plant tests happened to use single-line imports, which is precisely how a
 * blind spot survives its own test suite.
 *
 * So the anchor is now the `from` keyword, which every static import and
 * re-export must have regardless of how the clause is wrapped.
 *
 * `import type { X } from 'pkg'` is REPORTED SEPARATELY and not treated as a
 * dependency: it is erased at compile time and never reaches the bundle.
 * Rejecting it would make the guard fire on code that is genuinely safe, and a
 * guard that cries wolf gets bypassed. Inline `{ type A }` is deliberately NOT
 * treated as type-only — that statement still emits a runtime import.
 */
export function specifiersIn(src: string): string[] {
  const out: string[] = [];

  // Static `import ... from 'x'` / `export ... from 'x'`, newline-tolerant.
  // The clause is bounded so a runaway match cannot swallow the file: it may
  // not contain a `;`, or another import/export keyword.
  const STATIC = /\b(import|export)\b((?:(?!\b(?:import|export)\b|;)[\s\S])*?)\bfrom\s*['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(STATIC)) {
    const clause = (m[2] ?? '').trim();
    // Statement-level `import type` / `export type` is erased by the compiler.
    if (/^type\b/.test(clause)) continue;
    out.push(m[3]);
  }

  // Side-effect import: `import 'x';` with no clause at all.
  for (const m of src.matchAll(/(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);

  // Dynamic import.
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);

  return out;
}

/** Read a file and return the specifiers a bundler would follow. */
function specifiers(file: string): string[] {
  return specifiersIn(stripComments(readFileSync(file, 'utf8')));
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    // Agent worktrees live INSIDE the repo and would double every scan.
    if (name === 'node_modules' || name === '.git' || name === 'worktrees') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(p)) acc.push(p);
  }
  return acc;
}

/**
 * Resolve a relative specifier to a file on disk. `bundler` resolution means
 * `./x.js`, `./x.ts` and `./x` may all name `x.ts`, so all three are tried —
 * a resolver that only understood one of them would silently stop following
 * the graph and report a clean bill of health for an unexamined subtree.
 */
function resolveRelative(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const isRelative = (s: string) => s.startsWith('./') || s.startsWith('../');

// 0. ALIASES: this guard resolves RELATIVE specifiers only. If the project
// ever gains a path alias, a `@api/calls` import would be skipped silently and
// the guard would report green on an unexamined edge — pass by omission, the
// exact failure it exists to prevent. So it refuses to vouch rather than
// guessing. Derived from the config files, not from a memory of what they say.
const aliasSources: Array<[string, RegExp]> = [
  ['vite.config.ts', /\bresolve\s*:\s*{[\s\S]{0,400}?\balias\b/],
  ['tsconfig.json', /"paths"\s*:/],
  ['tsconfig.api.json', /"paths"\s*:/],
];
const aliasFound = aliasSources.filter(([f, re]) => {
  const p = join(ROOT, f);
  return existsSync(p) && re.test(readFileSync(p, 'utf8'));
});
if (aliasFound.length > 0) {
  console.error(
    '[check-client-safe-imports] path aliases configured in ' +
      aliasFound.map(([f]) => f).join(', ') +
      '\nThis guard resolves relative specifiers only, so it cannot follow an aliased' +
      '\nimport into api/ and will not report a boundary it did not examine.' +
      '\nTeach it the alias map before re-enabling.',
  );
  process.exit(1);
}

// 1. ENTRY POINTS: every import in src/ that resolves under api/.
const entries = new Map<string, string>(); // api file -> the src file that reaches it
for (const file of walk(SRC)) {
  for (const spec of specifiers(file)) {
    if (!isRelative(spec)) continue;
    const target = resolveRelative(file, spec);
    if (!target || !target.startsWith(API + '/')) continue;
    // Prefer a NON-TEST entry when reporting. A plant run blamed
    // `methodology.test.ts` for a violation the shipped page also causes,
    // which reads as "only a test does this" — the one message that would
    // get the finding waved through.
    const existing = entries.get(target);
    if (existing === undefined || (/\.test\.tsx?$/.test(existing) && !/\.test\.tsx?$/.test(file))) {
      entries.set(target, file);
    }
  }
}

if (entries.size === 0) {
  console.log('[check-client-safe-imports] OK — no src/ module imports from api/.');
  process.exit(0);
}

// 2. TRANSITIVE CLOSURE, and every bare specifier found inside it is a failure.
interface Violation {
  file: string;
  spec: string;
  via: string[];
}
const violations: Violation[] = [];
const seen = new Set<string>();
const unresolved: string[] = [];

const visit = (file: string, path: string[]) => {
  if (seen.has(file)) return;
  seen.add(file);
  for (const spec of specifiers(file)) {
    if (!isRelative(spec)) {
      violations.push({ file: relative(ROOT, file), spec, via: path.map((p) => relative(ROOT, p)) });
      continue;
    }
    const target = resolveRelative(file, spec);
    if (!target) {
      // Never pass silently on something we could not follow — an unresolved
      // edge is an unexamined subtree, which is how a guard reports green on
      // code it never read.
      unresolved.push(`${relative(ROOT, file)} -> ${spec}`);
      continue;
    }
    visit(target, [...path, file]);
  }
};

for (const [apiFile, srcFile] of entries) visit(apiFile, [srcFile]);

console.log(
  `[check-client-safe-imports] ${entries.size} api module(s) reachable from src/, ` +
    `${seen.size} in the transitive closure.`,
);

if (unresolved.length > 0) {
  console.error('\nCould not resolve these imports, so the guard cannot vouch for them:');
  for (const u of unresolved) console.error(`  ${u}`);
}

if (violations.length > 0) {
  console.error('\nFAIL — a client-reachable api/ module depends on a package:\n');
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    imports  ${v.spec}`);
    console.error(`    reached via  ${v.via.join(' -> ')}`);
  }
  console.error(
    '\nThe client bundle would carry it. Either keep the api module dependency-free,\n' +
      'or stop importing it from src/ and publish the value another way.\n',
  );
  process.exit(1);
}

if (unresolved.length > 0) process.exit(1);

console.log('OK — every client-reachable api/ module is dependency-free.');
