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

/** Every static import/export specifier, plus dynamic import(). */
const SPEC_RE =
  /(?:^|\n)\s*(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(SPEC_RE)) {
    const s = m[1] ?? m[2] ?? m[3];
    if (s) out.push(s);
  }
  return out;
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
