/**
 * Nothing builds a `style="..."` attribute except the one escaping helper.
 *
 * WHY. For four and a half months every style attribute that began with a font
 * stack was silently truncated: `styleAttr()` interpolated raw CSS into
 * `style="${inline}"` while every font token opens with a double-quoted family
 * (`"Inter"`), so the HTML tokenizer closed the attribute at that first quote.
 * 38 of 75 attributes in a rendered issue died at `style="font-family:"`,
 * discarding colour, size, weight and spacing. The dossier identity has never
 * rendered in a single email.
 *
 * WHY THIS GUARD AND NOT A RENDER TEST. A render test was written first, and an
 * adversary defeated it in one move: it planted an unescaped attribute into
 * `api/subscribe.ts` — the WELCOME EMAIL, the first thing a subscriber sees —
 * and the full suite stayed green, because the test only walks what
 * `renderDossierEmail` emits. Two of the three senders were protected by
 * convention, not construction. That is precisely the rule-5 failure the test's
 * own docstring claimed to prevent.
 *
 * So the property is asserted at the source: a template interpolation into a
 * style attribute is a violation ANYWHERE in api/, no matter which renderer it
 * belongs to or whether anyone has ever rendered it. A new sender is in scope
 * by default rather than by someone remembering to add it.
 *
 * src/ is reported as a WARNING, not a failure: the product UI has the same
 * defect at ~60 sites via innerHTML, but that is a separate, larger item and
 * failing the build on it today would only teach people to skip this check.
 *
 * Usage: npx tsx scripts/check-style-attr.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

/** The single permitted implementation. */
const IMPLEMENTATION = 'src/styles/email-tokens.ts';

/** Strip comments so a file that DOCUMENTS the pattern is not flagged for it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'worktrees') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

// `style="` immediately followed by a template interpolation — the exact shape
// that produced the bug. A static `style="margin:0"` is safe and not matched.
const UNSAFE = /style\s*=\s*(?:"|\\")\s*\$\{/;

const apiViolations: string[] = [];
const srcWarnings: string[] = [];

for (const file of [...walk(join(ROOT, 'api')), ...walk(join(ROOT, 'src'))]) {
  const rel = relative(ROOT, file);
  if (rel === IMPLEMENTATION) continue;
  const code = stripComments(readFileSync(file, 'utf8'));
  if (!UNSAFE.test(code)) continue;
  const lines = code.split('\n');
  const hits = lines.map((l, i) => (UNSAFE.test(l) ? `${rel}:${i + 1}` : null)).filter((x): x is string => x !== null);
  if (rel.startsWith('api/')) apiViolations.push(...hits);
  else srcWarnings.push(...hits);
}

if (srcWarnings.length > 0) {
  console.warn(
    `\n[check-style-attr] ${srcWarnings.length} site(s) in src/ interpolate into a style attribute. ` +
      `Same defect class, rendered through innerHTML rather than email — tracked separately, not failing the build:\n`,
  );
  for (const w of srcWarnings.slice(0, 10)) console.warn(`  ${w}`);
  if (srcWarnings.length > 10) console.warn(`  … and ${srcWarnings.length - 10} more`);
}

if (apiViolations.length > 0) {
  console.error(`\n[check-style-attr] FAILED — ${apiViolations.length} unescaped style attribute(s) in api/:\n`);
  for (const v of apiViolations) console.error(`  ${v}`);
  console.error(`
Every one of these silently truncates at the first double quote in the value,
and every font stack in src/styles/email-tokens.ts starts with one. Use the one
escaping helper instead:

    import { styleAttr, styleAttrOf, typeStyleAttr } from '../src/styles/email-tokens.js';
`);
  process.exit(1);
}

console.log(
  `[check-style-attr] OK — no unescaped style attributes in api/` +
    (srcWarnings.length ? ` (${srcWarnings.length} src/ site(s) warned)` : ''),
);
