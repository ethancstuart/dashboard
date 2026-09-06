/**
 * No NEW hex colour literals outside the two token sources.
 *
 * WHY. `docs/design-system.md` rule 2 — "no new hex literals in component CSS;
 * if you reach for one, the palette is missing a semantic name" — has been the
 * written rule since the design system was drafted, and nothing has ever
 * enforced it. What that costs is on this branch's own record: the
 * single-identity commit had to reclaim `index.html` and
 * `public/site.webmanifest` by hand, because both carried `#04050a` and
 * `#ff6600` — colours that appeared in NO token file — on two surfaces no
 * `src/` scan reaches. `api/brief/screenshot.ts` held a sixth private copy of
 * the palette and said so in a comment. A private copy of a colour is how an
 * identity change strands a public surface, which is the failure rule 8 exists
 * for; this is that rule with an exit code.
 *
 * WHY A RATCHET AND NOT A BAN. 302 literals survive across 31 files the day
 * this lands. The retired terminal orange `#ff6600` alone appears 39 times on
 * a branch whose whole premise is that the terminal identity is gone — still
 * the most common literal in the tree, ahead of the dossier's own oxblood at
 * 12. A guard
 * that fails 302 times on arrival is a guard someone switches off, and the
 * lesson already written into `.githooks/pre-push` is that friction gets
 * skipped rather than paid. So the SCOPE is derived and only the DEBT is
 * enumerated. The 113 files that are clean today are protected at zero, a file
 * that does not exist yet is protected at zero, and each dirty file is pinned
 * at exactly what it has.
 *
 * THE PIN IS EXACT IN BOTH DIRECTIONS, deliberately. A budget that is only
 * ever checked upward becomes a ceiling nobody lowers — which is how three
 * enumerated guard lists in this repo were found stale on 2026-08-30, two of
 * them silently. So REMOVING a literal fails too, with the corrected line
 * printed ready to paste. The cost is one line per cleanup commit. The benefit
 * is that BASELINE cannot quietly stop describing the tree.
 *
 * WHY THE SCOPE IS WIDER THAN IT FIRST WAS. The first version walked `src/`
 * and `api/` and then named `index.html` and `public/site.webmanifest` as two
 * known "unreachable surfaces". An independent review blocked it for exactly
 * that: naming the two files that had already burned us leaves a third to pass
 * by omission, which is the enumerate-don't-derive failure this repo has
 * legislated against, committed inside a guard whose own subject is deriving.
 *
 * Widening it to every served document found one immediately. `public/icons/
 * icon-192.svg` and `icon-512.svg` are a black `#0a0a0a` tile with an
 * `#ff6600` "NW" set in Courier New — the whole retired terminal identity,
 * font included. `index.html:6` points the browser tab at one and
 * `index.html:100` gives the other as the JSON-LD organisation logo, and the
 * manifest lists both for the install prompt. B1 reclaimed the two files that
 * POINT at these icons and not the icons themselves. The verdict that forced
 * the widening is in `.codex-reviews/feat-hex-literal-guard/`.
 *
 * WHAT IT DOES NOT PROVE. A per-file count cannot see a swap: delete one
 * literal and add a different one in the same file and the number is
 * unchanged. The blind spot is exactly the size of the remaining debt and
 * closes as each file reaches zero. Stated here rather than left to be
 * discovered, because a measurement without its conditions protects nothing.
 *
 * Usage: npx tsx scripts/check-hex-literals.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the repo from THIS FILE, never from `process.cwd()`. `npm run` sets
 * the cwd to the package root, so a cwd-based root works right up until the
 * first direct `node scripts/…` invocation from another directory — which
 * would scan a different tree while reporting on this one. An independent
 * review caught exactly that in `scripts/run-guards.mjs`.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The guarded property is "a colour that reaches a browser", so the scope is
 * the three directories whose contents reach one: `src/` and `api/` generate
 * the markup, `public/` is served verbatim. Everything inside them is walked
 * by extension. No file is named.
 */
const SCAN_ROOTS = ['src', 'api', 'public'];

/** Anything a browser can be handed and read as text. Binaries are excluded
 *  by omission from this set, not by a skip list. */
const SERVED_TEXT = /\.(tsx?|css|html|svg|webmanifest|js)$/;

/**
 * Served documents that sit at the repo ROOT rather than inside a served
 * directory — `index.html` today, and nothing else. DERIVED from the root
 * listing by extension rather than named, so a second root document is in
 * scope the day it appears. Non-recursive, and deliberately excluding `.ts`
 * and `.js`: `vite.config.ts` and `eslint.config.js` live here too and are
 * build configuration, never served.
 */
const ROOT_DOCUMENT = /\.(html|css|svg|webmanifest)$/;

/**
 * The palette must be stated somewhere. These are the two places allowed to
 * state it: `email-tokens.ts` is the root every other surface imports, and
 * `tokens.css` is its static mirror for surfaces that cannot import a module.
 *
 * Note what is deliberately NOT here. `src/styles/design-tokens.css` is an
 * older second token file still carrying the retired accent; it is pinned in
 * BASELINE rather than exempted, so that absorbing it is a change this guard
 * can see.
 */
const TOKEN_SOURCES = new Set(['src/styles/email-tokens.ts', 'src/styles/tokens.css']);

/**
 * A CSS colour literal: `#` then exactly 3, 4, 6 or 8 hex digits, not running
 * on into a longer word. The alternation is ordered longest-first so
 * `#ff660040` reads as one 8-digit match rather than a 6-digit match with a
 * stray tail.
 *
 * `(?<!&)` drops HTML numeric entities (`&#123;`), which are otherwise a
 * perfect three-digit match. It deliberately does NOT also exclude a preceding
 * word character: that would blind the guard to `solid#fff`, and a URL
 * fragment shaped like a colour occurs zero times in this tree — measured on
 * every scanned file, both variants, identical counts.
 */
const HEX_SOURCE = String.raw`(?<!&)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_])`;

export interface HexHit {
  line: number;
  value: string;
}

/**
 * Comments are documentation, not colour — a file that records "was #04050a"
 * in a comment is doing the right thing and must not be charged for it.
 *
 * This MASKS comments with spaces instead of deleting them, which is the one
 * way it differs from `stripComments` in `scripts/check-client-safe-imports.ts`
 * (kept separate on purpose; that one's callers only ask whether a pattern is
 * present, this one has to say WHERE). Deleting a block comment shifts every
 * line after it, and a guard that points at the wrong line is telling the
 * reader something false.
 *
 * Stripping is per extension rather than one dialect for everything: `//` is
 * not a comment in CSS or JSON, and `<!-- -->` is not one in TypeScript.
 */
export function maskComments(src: string, ext: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  let out = src;
  // Block comments: TypeScript, CSS, JavaScript, and the inline <style> in an
  // HTML or SVG document. JSON and the manifest have no comment syntax at all.
  if (ext !== '.webmanifest' && ext !== '.json') out = out.replace(/\/\*[\s\S]*?\*\//g, blank);
  // Line comments: the script dialects only. The `[^:]` guard keeps `https://`
  // intact, and CSS is excluded because `//` is not a comment there.
  if (/^\.(tsx?|js)$/.test(ext)) out = out.replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1);
  // Markup comments: index.html, where the identity notes sit beside the CSS,
  // and the icon SVGs, which are XML and take the same form.
  if (ext === '.html' || ext === '.svg') out = out.replace(/<!--[\s\S]*?-->/g, blank);
  return out;
}

/** Every colour literal in a file, with the line it is really on. */
export function hexHitsIn(src: string, ext: string): HexHit[] {
  const code = maskComments(src, ext);
  const hits: HexHit[] = [];
  let line = 1;
  let cursor = 0;
  for (const m of code.matchAll(new RegExp(HEX_SOURCE, 'g'))) {
    const index = m.index ?? 0;
    for (; cursor < index; cursor++) if (code[cursor] === '\n') line++;
    hits.push({ line, value: m[0] });
  }
  return hits;
}

/**
 * THE DEBT, file by file, as it stood when this guard landed. Every entry is a
 * hex literal that should be a token. Counts may only move by editing this
 * block in the same commit that moves them.
 */
export const BASELINE: Readonly<Record<string, number>> = {
  'api/admin/brief/preview.ts': 1,
  'api/alerts/subscribe.ts': 8,
  'api/alerts/unsubscribe.ts': 10,
  'api/alerts/verify.ts': 10,
  'api/brief/og.ts': 9,
  'api/briefs-sample.ts': 9,
  'api/cron/daily-brief.ts': 9,
  'api/unsubscribe.ts': 3,
  'index.html': 8,
  // PINNED, NOT ACCEPTED. These are the favicon, the PWA install icon and the
  // JSON-LD organisation logo, and they are still the retired terminal
  // identity: a #0a0a0a tile with an #ff6600 "NW" set in Courier New. B1
  // reclaimed index.html and site.webmanifest, which POINT at these two files.
  // The recolour is a design decision and belongs to the identity lane.
  'public/icons/icon-192.svg': 4,
  'public/icons/icon-512.svg': 4,
  // An unreferenced manual OG-image tool from the terminal era. #00ff88 belongs
  // to no palette in this repo. A deletion candidate, not a token candidate.
  'public/og-gen.html': 19,
  'public/site.webmanifest': 2,
  'src/main.ts': 16,
  'src/pages/briefs.ts': 19,
  'src/pages/mcp.ts': 20,
  'src/pages/status.ts': 10,
  'src/services/confidenceScoring.ts': 3,
  'src/services/countryInstabilityIndex.ts': 4,
  'src/services/dataProvenance.ts': 4,
  'src/services/verificationEngine.ts': 4,
  'src/styles/auth.css': 3,
  'src/styles/base.css': 3,
  'src/styles/briefs-dossier.css': 26,
  'src/styles/briefs.css': 46,
  'src/styles/design-tokens.css': 21,
  'src/styles/landing.css': 9,
  'src/styles/mobile.css': 7,
  'src/styles/pwa.css': 3,
  'src/styles/toast.css': 2,
  'src/ui/dataToast.ts': 6,
};

export interface Failure {
  file: string;
  /** Why the pin is wrong, in the imperative the reader has to act on. */
  message: string;
  /** True when the file carries more literals than it is pinned for. */
  overBudget: boolean;
  /** The paste-ready BASELINE line that would make this file agree. */
  correction: string;
}

export interface Verdict {
  /** Empty means the tree matches the baseline exactly. */
  failures: Failure[];
  /** Total pinned literals still outstanding. */
  debt: number;
}

/**
 * Compare a full scan against the baseline. `counts` must carry EVERY scanned
 * file, including the clean ones at zero: that is what lets a file cleaned to
 * zero be told apart from a file that left the scope entirely, and the two
 * want different edits.
 */
export function compareToBaseline(counts: Record<string, number>, baseline: Record<string, number>): Verdict {
  const failures: Failure[] = [];
  let debt = 0;

  for (const file of Object.keys(counts).sort()) {
    const found = counts[file] ?? 0;
    const pinned = baseline[file] ?? 0;
    debt += Math.min(found, pinned);
    if (found === pinned) continue;
    if (found > pinned) {
      failures.push({
        file,
        overBudget: true,
        message:
          pinned === 0
            ? `${found} hex literal(s) in a file that had none`
            : `${found} hex literals against a pin of ${pinned} — ${found - pinned} added`,
        correction: `  '${file}': ${found},`,
      });
    } else if (found === 0) {
      failures.push({
        file,
        overBudget: false,
        message: `clean now, pinned at ${pinned} — delete its BASELINE line`,
        correction: `  (delete) '${file}': ${pinned},`,
      });
    } else {
      failures.push({
        file,
        overBudget: false,
        message: `down to ${found} from ${pinned} — tighten the pin, don't leave slack`,
        correction: `  '${file}': ${found},`,
      });
    }
  }

  for (const file of Object.keys(baseline).sort()) {
    if (file in counts) continue;
    failures.push({
      file,
      overBudget: false,
      message: `pinned at ${baseline[file]} but no longer scanned — deleted, renamed, or exempted`,
      correction: `  (delete) '${file}': ${baseline[file]},`,
    });
  }

  return { failures, debt };
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    // Tests are excluded on purpose: a test that asserts the card background
    // EQUALS the token can only do that by writing the value down, and
    // api/_lib/satori-html.test.ts is doing exactly the right thing.
    else if (SERVED_TEXT.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** Served documents at the repo root, by extension, one level only. */
function rootDocuments(): string[] {
  return readdirSync(ROOT)
    .filter((e) => ROOT_DOCUMENT.test(e))
    .map((e) => join(ROOT, e))
    .filter((f) => statSync(f).isFile());
}

function main(): void {
  const files = [...SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r))), ...rootDocuments()];

  // A filter that silently matches nothing is how a guard passes while
  // guarding nothing. run-guards.mjs refuses the same way.
  if (files.length === 0) {
    console.error('[check-hex-literals] no files matched — refusing to report success');
    process.exit(1);
  }

  const counts: Record<string, number> = {};
  const hitsByFile = new Map<string, HexHit[]>();

  for (const file of files) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (TOKEN_SOURCES.has(rel)) continue;
    const hits = hexHitsIn(readFileSync(file, 'utf8'), extname(file));
    counts[rel] = hits.length;
    if (hits.length > 0) hitsByFile.set(rel, hits);
  }

  const { failures, debt } = compareToBaseline(counts, BASELINE);

  if (failures.length > 0) {
    console.error(`\n[check-hex-literals] FAILED — ${failures.length} file(s) disagree with the baseline:\n`);
    for (const f of failures) {
      console.error(`  ${f.file} — ${f.message}`);
      // Only an over-budget file gets its sites printed: those are the ones
      // someone has to go and change. A stale pin needs a number, not a tour.
      const hits = f.overBudget ? (hitsByFile.get(f.file) ?? []) : [];
      for (const h of hits.slice(0, 10)) console.error(`      ${f.file}:${h.line}  ${h.value}`);
      if (hits.length > 10) console.error(`      … and ${hits.length - 10} more`);
    }
    console.error(`
A colour belongs in src/styles/email-tokens.ts (the root every surface imports)
or in src/styles/tokens.css (its static mirror), and is used from there — as a
token import in TypeScript, or a var(--…) in CSS. If none of the existing names
fit, the palette is missing one: add it there first, then use it.

If a literal is genuinely unavoidable, say so by editing BASELINE in
scripts/check-hex-literals.ts in the same commit, and say why in the message:

${failures.map((f) => f.correction).join('\n')}
`);
    process.exit(1);
  }

  console.log(
    `[check-hex-literals] OK — ${Object.keys(counts).length} files scanned, ` +
      `no hex outside the ${TOKEN_SOURCES.size} token sources except ${debt} pinned literal(s) ` +
      `in ${Object.keys(BASELINE).length} file(s).`,
  );
}

// Run only when invoked directly, never on import — the test suite imports the
// pure functions above, and a process.exit on import would kill vitest.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
