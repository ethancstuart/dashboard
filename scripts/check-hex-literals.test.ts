import { describe, it, expect } from 'vitest';
import { hexHitsIn, maskComments, compareToBaseline } from './check-hex-literals.ts';

const values = (src: string, ext = '.ts') => hexHitsIn(src, ext).map((h) => h.value);

/**
 * THE EXTRACTOR IS TESTED DIRECTLY, NOT ONLY THROUGH THE EXIT CODE.
 *
 * `scripts/check-client-safe-imports.ts` reported green while blind for its
 * first three plant tests, because all three used the one import shape its
 * regex could see. The exit code said OK and meant nothing. So the two pure
 * functions this guard's verdict rests on — what counts as a colour, and what
 * counts as a disagreement with the baseline — are asserted here on their own,
 * where a blind spot has to show up as a wrong value rather than as silence.
 */
describe('what counts as a colour literal', () => {
  it('finds 3, 4, 6 and 8 digit forms, in either case', () => {
    expect(values('a{color:#fff}')).toEqual(['#fff']);
    expect(values('a{color:#fff8}')).toEqual(['#fff8']);
    expect(values('a{color:#FAF8F3}')).toEqual(['#FAF8F3']);
    expect(values('a{color:#ff660040}')).toEqual(['#ff660040']);
  });

  it('reads #ff660040 as ONE eight-digit match, not six digits and a tail', () => {
    // The alternation is ordered longest-first for exactly this. Read the
    // other way round it would score two literals where the file has one, and
    // every alpha colour in briefs.css would inflate the baseline.
    expect(hexHitsIn('a{color:#ff660040}', '.css')).toHaveLength(1);
  });

  it('finds a literal hiding as a var() fallback — where the retired orange lives', () => {
    // src/main.ts's 404 screen renders var(--nw-accent, #ff6600): the token is
    // named AND the dead terminal orange ships whenever the token is absent.
    expect(values('el.style.color = "var(--nw-accent, #ff6600)";')).toEqual(['#ff6600']);
  });

  it('ignores hash routes and ids, which are not colours', () => {
    expect(values('a.href = "#/ledger";')).toEqual([]);
    expect(values('<main id="main-content">', '.html')).toEqual([]);
  });

  it('ignores HTML numeric entities, which are a perfect three-digit match', () => {
    expect(values('const s = "&#123;";')).toEqual([]);
    expect(values("const s = '&#39;';")).toEqual([]);
  });

  it('ignores runs too short or too long to be a colour', () => {
    expect(values('// PR #36 and #4')).toEqual([]);
    expect(values('const id = "#123456789";')).toEqual([]);
  });

  it('does not charge a file for a colour it only names in a comment', () => {
    // The identity commits deliberately left comments saying which value a
    // surface used to carry. Reading those as debt would punish the note.
    expect(values('// was #04050a before the dossier\nconst x = 1;')).toEqual([]);
    expect(values('/* #ff6600 was the terminal accent */')).toEqual([]);
    expect(values('a{/* #ff6600 */color:#9a1b1b}', '.css')).toEqual(['#9a1b1b']);
    expect(values('<!-- was #04050a --><meta content="#faf8f3">', '.html')).toEqual(['#faf8f3']);
  });

  it('reads an SVG as markup — the icon files are XML, and they are in scope', () => {
    // public/icons/icon-*.svg is the favicon, the install icon and the JSON-LD
    // logo. Scoping them in is what found that all three are still the retired
    // terminal identity, so the dialect they are written in has to be handled.
    expect(values('<!-- was #ff6600 --><rect fill="#9a1b1b"/>', '.svg')).toEqual(['#9a1b1b']);
  });

  it('does NOT treat // as a comment in CSS, where it is not one', () => {
    // A TypeScript stripper turned loose on a stylesheet would blank the rest
    // of any line holding a protocol-relative url() and hide the colours after
    // it. There are none in the tree today; that is luck, not construction.
    expect(values('a{background:url(//cdn.example.com/x.png);color:#9a1b1b}', '.css')).toEqual(['#9a1b1b']);
  });

  it('keeps https:// intact in TypeScript', () => {
    expect(values('const u = "https://x.dev"; const c = "#9a1b1b";')).toEqual(['#9a1b1b']);
  });

  it('reports the line the literal is really on, after a multi-line comment', () => {
    // Masking rather than deleting is the whole reason for this: a deleted
    // block comment shifts every line after it, and a guard that points at the
    // wrong line is telling the reader something false.
    const src = '/*\n * a comment\n * spanning lines\n */\nconst c = "#9a1b1b";';
    expect(hexHitsIn(src, '.ts')).toEqual([{ line: 5, value: '#9a1b1b' }]);
  });
});

describe('what counts as disagreeing with the baseline', () => {
  it('passes when every file matches its pin exactly', () => {
    const v = compareToBaseline({ 'a.css': 3, 'b.ts': 0 }, { 'a.css': 3 });
    expect(v.failures).toEqual([]);
    expect(v.debt).toBe(3);
  });

  it('fails a clean file that gains one — the case the guard exists for', () => {
    const v = compareToBaseline({ 'src/ui/kit/index.ts': 1 }, {});
    expect(v.failures).toHaveLength(1);
    expect(v.failures[0]?.overBudget).toBe(true);
    expect(v.failures[0]?.correction).toBe(`  'src/ui/kit/index.ts': 1,`);
  });

  it('fails a file that is NOT in the baseline at all, so a new file starts at zero', () => {
    // Fails by default rather than passing by omission: the enumerate-vs-derive
    // rule this repo wrote into .githooks/pre-push after the fifth guard would
    // have slipped through a hand-kept list.
    expect(compareToBaseline({ 'src/pages/brand-new.ts': 2 }, {}).failures).toHaveLength(1);
  });

  it('fails a REDUCTION too, and prints the tightened line', () => {
    // Deliberate. A pin only ever checked upward is a ceiling nobody lowers.
    const v = compareToBaseline({ 'a.css': 2 }, { 'a.css': 5 });
    expect(v.failures[0]?.overBudget).toBe(false);
    expect(v.failures[0]?.correction).toBe(`  'a.css': 2,`);
  });

  it('tells a file cleaned to zero apart from a file that left the scope', () => {
    const cleaned = compareToBaseline({ 'a.css': 0 }, { 'a.css': 5 });
    expect(cleaned.failures[0]?.message).toContain('clean now');
    const gone = compareToBaseline({}, { 'a.css': 5 });
    expect(gone.failures[0]?.message).toContain('no longer scanned');
    // Both want the line deleted, and both say so.
    expect(cleaned.failures[0]?.correction).toContain('(delete)');
    expect(gone.failures[0]?.correction).toContain('(delete)');
  });

  it('counts outstanding debt as what is actually still there', () => {
    expect(compareToBaseline({ 'a.css': 2, 'b.css': 4 }, { 'a.css': 5, 'b.css': 4 }).debt).toBe(6);
  });
});

describe('the masker preserves offsets', () => {
  it('replaces comments with spaces of the same length, newlines kept', () => {
    const src = 'x/* abc */y';
    expect(maskComments(src, '.css')).toBe('x         y');
    expect(maskComments(src, '.css')).toHaveLength(src.length);
  });

  it('leaves a .webmanifest alone — JSON has no comments to mask', () => {
    const src = '{"theme_color": "#FAF8F3"}';
    expect(maskComments(src, '.webmanifest')).toBe(src);
  });
});
