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
 * 12. A guard that fails 302 times on arrival is a guard someone switches off,
 * and the lesson already written into `.githooks/pre-push` is that friction
 * gets skipped rather than paid. So the SCOPE is derived and only the DEBT is
 * enumerated. The 117 files that are clean today are pinned at empty, a file
 * that does not exist yet is pinned at empty, and each dirty file is pinned at
 * exactly the colours it holds.
 *
 * THE PIN IS THE MULTISET, NOT A COUNT, and it matches exactly in both
 * directions. `'14×#ff6600 6×#e0e0e0'` says which colours are stranded where,
 * so BASELINE reads as an inventory of the identity debt rather than as a
 * column of numbers. A count alone would let a file swap one literal for a
 * different one at the same total and pass — an independent review named that
 * hole twice, and pinning the values closes it. Removing a literal fails too,
 * with the corrected line printed ready to paste: a budget only ever checked
 * upward is the ceiling nobody lowers, which is how three enumerated guard
 * lists in this repo were found stale on 2026-08-30, two of them silently.
 *
 * WHY THE SCOPE IS WIDER THAN IT FIRST WAS, TWICE. The first version walked
 * `src/` and `api/` and then NAMED `index.html` and `public/site.webmanifest`
 * as two known "unreachable surfaces". An independent review blocked it for
 * exactly that: naming the two files that had already burned us leaves a third
 * to pass by omission, which is the enumerate-don't-derive failure this repo
 * has legislated against, committed inside a guard whose own subject is
 * deriving. The second version replaced them with a walk of `public/` and a
 * derived root-document rule, and the same review blocked it again for the
 * extension allowlist underneath — a new served file type would still pass by
 * omission. So membership is now decided by CONTENT: every file under the
 * served roots that is text is in scope, and binaries fall out because they
 * hold a NUL byte. Measured when it changed: four files joined the scan
 * (`api/.gitkeep`, `api/tsconfig.json`, `api/_fonts/README.md`,
 * `public/robots.txt`) and all four are clean, so the widening cost nothing.
 *
 * WHAT WIDENING IT FOUND. `public/icons/icon-192.svg` and `icon-512.svg` are a
 * `#0a0a0a` tile with an `#ff6600` "NW" set in Courier New — the whole retired
 * terminal identity, font included. `index.html:6` points the browser tab at
 * one and `index.html:100` gives the other as the JSON-LD organisation logo,
 * and the manifest lists both for the install prompt. B1 reclaimed the two
 * files that POINT at these icons and not the icons themselves.
 *
 * WHERE THE DERIVATION STOPS, AND WHY IT STOPS THERE. A third review round
 * blocked this again for naming `src`, `api` and `public` at all. That
 * objection has a limit: no guard can define its universe without naming
 * something, and the only alternative — walk the whole repo — means
 * enumerating EXCLUSIONS instead. `docs/` alone holds 391 literals in
 * generated Lighthouse reports, `ledger-snapshots/` holds sixteen 300 KB
 * fixtures, and this guard's own test file asserts colours on purpose. That is
 * the same list wearing the opposite sign, and a longer one.
 *
 * These three roots are not a list of places colour has been found. They are
 * the deployment contract: Vite builds `index.html` plus `src/` and copies
 * `public/` verbatim, Vercel runs `api/`, and nothing else reaches a browser.
 * A fourth served root cannot appear without an edit to `vite.config.ts` or
 * `vercel.json`. The residual is that such an edit lands and nobody updates
 * this line — stated here rather than defended against, because defending
 * against it means parsing the build config to learn what the build config
 * says.
 *
 * WHAT IT STILL DOES NOT PROVE. It reads text, so a colour computed at runtime
 * (`'#' + code`) or held in a database row is invisible to it. It says nothing
 * about whether a pinned literal is the RIGHT colour — only that the set has
 * not changed behind anyone's back. And a `//` INSIDE a TypeScript string is
 * read as the start of a comment, so a literal after one on the same line
 * would be masked away: measured at zero instances across 122 script files,
 * and a quote-parity heuristic was rejected because `const s = "it's"; //
 * #ff6600` would then be charged for a comment — trading a blind spot with no
 * instances for a false positive with several.
 *
 * Usage: npx tsx scripts/check-hex-literals.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
 * the markup, `public/` is served verbatim. Everything inside them that is
 * text is walked. No file and no file type is named.
 */
const SERVED_ROOTS = ['src', 'api', 'public'];

/**
 * Served documents that sit at the repo ROOT rather than inside a served
 * directory — `index.html` today. Derived from the root listing by extension
 * rather than named, so a second root document is in scope the day it appears.
 *
 * This is the one place an extension rule survives, and it is narrower than
 * the served roots ON PURPOSE. Nothing at the repo root is served except the
 * app shell: Vercel serves `public/` and the build output, and the rest of the
 * root is build configuration — `package.json`, `vercel.json`,
 * `eslint.config.js`, `vite.config.ts`, `CLAUDE.md`. Scanning root text files
 * by content would charge the repo for colours in its own documentation.
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
 * Stripping is per dialect rather than one rule for everything: `//` is not a
 * comment in CSS or JSON, and `<!-- -->` is not one in TypeScript.
 */
export function maskComments(src: string, ext: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  let out = src;
  // Block comments: TypeScript, CSS, JavaScript, and the inline <style> in an
  // HTML or SVG document. JSON and the manifest have no comment syntax at all.
  if (ext !== '.webmanifest' && ext !== '.json') out = out.replace(/\/\*[\s\S]*?\*\//g, blank);
  // Line comments: the script dialects only. The `[^:]` guard keeps `https://`
  // intact, and CSS is excluded because `//` is not a comment there.
  if (/^\.(tsx?|js|mjs)$/.test(ext)) out = out.replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1);
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
 * The multiset of colours in a file, as one readable line: `14×#ff6600 6×#fff`,
 * commonest first, ties broken alphabetically so the string is stable.
 *
 * Case is folded because `#FAF8F3` and `#faf8f3` are the same colour and
 * `index.html` writes it both ways. The total is the sum of the counts, so
 * there is no second number that can disagree with this one.
 */
export function fingerprint(hits: readonly HexHit[]): string {
  const tally = new Map<string, number>();
  for (const h of hits) {
    const v = h.value.toLowerCase();
    tally.set(v, (tally.get(v) ?? 0) + 1);
  }
  return [...tally]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([v, n]) => `${n}×${v}`)
    .join(' ');
}

/**
 * THE DEBT, file by file, as it stood when this guard landed — an inventory of
 * every colour that should be a token and is not. Entries may only change by
 * editing this block in the same commit that changes the file.
 */
export const BASELINE: Readonly<Record<string, string>> = {
  'api/admin/brief/preview.ts': '1×#faf8f3',
  'api/alerts/subscribe.ts': '3×#9a1b1b 1×#12161c 1×#3b4252 1×#888 1×#faf8f3 1×#fff',
  'api/alerts/unsubscribe.ts': '2×#9a1b1b 2×#fff 1×#12161c 1×#22c55e 1×#3b4252 1×#dc2626 1×#e5e0d4 1×#faf8f3',
  'api/alerts/verify.ts': '2×#9a1b1b 2×#fff 1×#12161c 1×#22c55e 1×#3b4252 1×#dc2626 1×#e5e0d4 1×#faf8f3',
  'api/brief/og.ts': '3×#9a1b1b 2×#12161c 2×#c9c3b4 1×#3b4252 1×#faf8f3',
  'api/briefs-sample.ts': '2×#06b6d4 2×#dc2626 2×#ff6600 1×#22c55e 1×#a855f7 1×#eab308',
  'api/cron/daily-brief.ts': '2×#2a2f38 2×#e8e6de 1×#0e1116 1×#161b22 1×#8b8478 1×#c2bcab 1×#d66a64',
  'api/unsubscribe.ts': '1×#12161c 1×#4a4f57 1×#faf8f3',
  'index.html': '3×#faf8f3 1×#12161c 1×#1a1a1a 1×#3b4252 1×#666 1×#c9a86b',
  // PINNED, NOT ACCEPTED. These are the favicon, the PWA install icon and the
  // JSON-LD organisation logo, and they are still the retired terminal
  // identity: a #0a0a0a tile with an #ff6600 "NW" set in Courier New. B1
  // reclaimed index.html and site.webmanifest, which POINT at these two files.
  // The recolour is a design decision and belongs to the identity lane.
  'public/icons/icon-192.svg': '3×#ff6600 1×#0a0a0a',
  'public/icons/icon-512.svg': '3×#ff6600 1×#0a0a0a',
  // An unreferenced manual OG-image tool from the terminal era. #00ff88 belongs
  // to no palette in this repo. A deletion candidate, not a token candidate.
  'public/og-gen.html': '12×#00ff88 1×#0a0a0f 1×#111 1×#1a1a2e 1×#555 1×#666 1×#888 1×#fff',
  'public/site.webmanifest': '2×#faf8f3',
  'src/main.ts': '4×#757575 4×#ededed 4×#ff6600 2×#000 2×#222',
  'src/pages/briefs.ts':
    '3×#3d3a35 3×#ddd8ce 2×#8b8478 2×#b8341c 1×#06b6d4 1×#1f7a4c 1×#222 1×#6b7280 1×#999 1×#9a1b1b 1×#dc2626 1×#e5e0d4 1×#ff6600',
  'src/pages/mcp.ts': '6×#ff6600 4×#2a2a2a 3×#888 2×#0f0f0f 2×#22c55e 2×#ccc 1×#e0e0e0',
  'src/pages/status.ts': '3×#22c55e 3×#dc2626 3×#eab308 1×#757575',
  'src/services/confidenceScoring.ts': '1×#22c55e 1×#dc2626 1×#eab308',
  'src/services/countryInstabilityIndex.ts': '1×#22c55e 1×#dc2626 1×#eab308 1×#f97316',
  'src/services/dataProvenance.ts': '1×#22c55e 1×#dc2626 1×#eab308 1×#f97316',
  'src/services/verificationEngine.ts': '1×#22c55e 1×#6b7280 1×#eab308 1×#f97316',
  'src/styles/auth.css': '2×#8b5cf6 1×#f59e0b',
  'src/styles/base.css': '1×#0a0a0a 1×#ededed 1×#fff',
  'src/styles/briefs-dossier.css':
    '2×#757575 2×#999 2×#ededed 2×#ff6600 2×#ffffff 1×#111 1×#12161c 1×#1f7a4c 1×#222 1×#3b4252 1×#6b7280 1×#9a1b1b 1×#b8341c 1×#c7453f 1×#c9a86b 1×#c9c3b4 1×#e5d8b6 1×#e5e0d4 1×#f2efe6 1×#f6e4e2 1×#faf8f3',
  'src/styles/briefs.css':
    '14×#ff6600 5×#888 5×#e0e0e0 3×#0a0a0a 3×#1a1a1a 3×#333 3×#666 2×#555 1×#000 1×#aaa 1×#ccc 1×#ff660010 1×#ff660015 1×#ff660030 1×#ff660040 1×#ff7722',
  'src/styles/design-tokens.css':
    '2×#00d4aa 2×#1a1a1a 2×#dc2626 2×#e5a913 2×#ff6600 1×#000000 1×#0a0a0a 1×#111111 1×#181818 1×#222222 1×#22c55e 1×#6b8aff 1×#757575 1×#999999 1×#ededed 1×#ff7722',
  'src/styles/landing.css': '5×#000 2×#050505 1×#0a0a0a 1×#0c0c0c',
  'src/styles/mobile.css': '2×#000 1×#0a0a0a 1×#1a1a1a 1×#888 1×#ff6600 1×#fff',
  'src/styles/pwa.css': '1×#000 1×#ff6600 1×#fff',
  'src/styles/toast.css': '2×#fff',
  'src/ui/dataToast.ts': '1×#1a0a0a 1×#1a1400 1×#666 1×#dc2626 1×#e5a913 1×#ededed',
};

export interface Failure {
  file: string;
  /** Why the pin is wrong, in the imperative the reader has to act on. */
  message: string;
  /** True when the file carries colours its pin does not account for. */
  overBudget: boolean;
  /** The paste-ready BASELINE line that would make this file agree. */
  correction: string;
}

/**
 * Compare a full scan against the baseline. `found` must carry EVERY scanned
 * file, including the clean ones at `''`: that is what lets a file cleaned to
 * empty be told apart from a file that left the scope entirely, and the two
 * want different edits.
 */
export function compareToBaseline(
  found: Record<string, string>,
  baseline: Record<string, string>,
): { failures: Failure[] } {
  const failures: Failure[] = [];
  const total = (fp: string) =>
    fp === '' ? 0 : fp.split(' ').reduce((n, part) => n + Number(part.split('×')[0] ?? 0), 0);

  for (const file of Object.keys(found).sort()) {
    const now = found[file] ?? '';
    const pinned = baseline[file] ?? '';
    if (now === pinned) continue;
    if (now === '') {
      failures.push({
        file,
        overBudget: false,
        message: `clean now, pinned at "${pinned}" — delete its BASELINE line`,
        correction: `  (delete) '${file}',`,
      });
      continue;
    }
    const grew = total(now) > total(pinned);
    failures.push({
      file,
      overBudget: grew,
      message:
        pinned === ''
          ? `${total(now)} hex literal(s) in a file that had none — ${now}`
          : grew
            ? `pinned at "${pinned}", now "${now}"`
            : `changed and did not grow: pinned "${pinned}", now "${now}" — tighten the pin, don't leave slack`,
      correction: `  '${file}': '${now}',`,
    });
  }

  for (const file of Object.keys(baseline).sort()) {
    if (file in found) continue;
    failures.push({
      file,
      overBudget: false,
      message: `pinned at "${baseline[file]}" but no longer scanned — deleted, renamed, or exempted`,
      correction: `  (delete) '${file}',`,
    });
  }

  return { failures };
}

/**
 * Membership by CONTENT, not by extension. An extension allowlist is a list of
 * known cases, and the next served file type is exactly the case a list does
 * not have — which is what an independent review blocked the previous version
 * for. A binary holds a NUL byte in its first pages; nothing text does.
 */
function isTextFile(path: string): boolean {
  return !readFileSync(path).subarray(0, 8192).includes(0);
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
    else if (!/\.test\.tsx?$/.test(full) && isTextFile(full)) out.push(full);
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
  const files = [...SERVED_ROOTS.flatMap((r) => walk(join(ROOT, r))), ...rootDocuments()];

  // A filter that silently matches nothing is how a guard passes while
  // guarding nothing. run-guards.mjs refuses the same way.
  if (files.length === 0) {
    console.error('[check-hex-literals] no files matched — refusing to report success');
    process.exit(1);
  }

  const found: Record<string, string> = {};
  const hitsByFile = new Map<string, HexHit[]>();
  let debt = 0;

  for (const file of files) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (TOKEN_SOURCES.has(rel)) continue;
    const hits = hexHitsIn(readFileSync(file, 'utf8'), extname(file));
    found[rel] = fingerprint(hits);
    if (hits.length > 0) {
      hitsByFile.set(rel, hits);
      if (rel in BASELINE) debt += hits.length;
    }
  }

  const { failures } = compareToBaseline(found, BASELINE);

  if (failures.length > 0) {
    console.error(`\n[check-hex-literals] FAILED — ${failures.length} file(s) disagree with the baseline:\n`);
    for (const f of failures) {
      console.error(`  ${f.file} — ${f.message}`);
      // Only a file carrying MORE than its pin gets its sites printed: those
      // are the ones someone has to go and change. A stale pin needs a line,
      // not a tour.
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
    `[check-hex-literals] OK — ${Object.keys(found).length} files scanned, ` +
      `no hex outside the ${TOKEN_SOURCES.size} token sources except ${debt} pinned literal(s) ` +
      `in ${Object.keys(BASELINE).length} file(s).`,
  );
}

// Run only when invoked directly, never on import — the test suite imports the
// pure functions above, and a process.exit on import would kill vitest.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
