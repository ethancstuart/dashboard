import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { htmlToSatori, parseStyle, decodeEntities } from './satori-html.js';

describe('htmlToSatori', () => {
  // Satori takes an element tree. Handed a raw string it renders the MARKUP as
  // prose and still returns a valid 1200x630 PNG — status 200, content-type
  // image/png, and blank. Nothing but looking at the pixels catches that, so
  // the shape is asserted here instead.
  it('produces an element tree, not a string', () => {
    const node = htmlToSatori('<div style="display:flex;color:#fff"><span>hi</span></div>');
    expect(typeof node).toBe('object');
    expect(node.type).toBe('div');
    expect(node.props.style).toEqual({ display: 'flex', color: '#fff' });
    expect(node.props.children).toEqual([{ type: 'span', props: { children: ['hi'] }, key: null }]);
  });

  it('drops template indentation instead of turning it into content', () => {
    const node = htmlToSatori('<div>\n  <span>a</span>\n  <span>b</span>\n</div>');
    expect((node.props.children as unknown[]).length).toBe(2);
  });

  it('decodes the entities escapeHtml() produced, so text reads as written', () => {
    const node = htmlToSatori('<div><span>Fitch &amp; Moody&#39;s &lt;note&gt;</span></div>');
    const span = (node.props.children as Array<{ props: { children: string[] } }>)[0];
    expect(span.props.children[0]).toBe("Fitch & Moody's <note>");
  });

  it('throws on unbalanced markup rather than rendering something else', () => {
    expect(() => htmlToSatori('<div><span>a</div>')).toThrow(/unbalanced|unclosed/);
    expect(() => htmlToSatori('<div>a</div>')).not.toThrow();
  });

  it('camelCases style properties and keeps font stacks intact', () => {
    expect(parseStyle("font-family:'JetBrains Mono', ui-monospace, Menlo, monospace;letter-spacing:0.18em")).toEqual({
      fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace",
      letterSpacing: '0.18em',
    });
  });

  it('leaves an unknown entity alone rather than guessing at it', () => {
    expect(decodeEntities('a &notareal; b')).toBe('a &notareal; b');
  });
});

/**
 * DERIVED, NOT ENUMERATED. This does not list the renderers it knows about —
 * it finds every ImageResponse construction under api/ and demands that its
 * first argument went through htmlToSatori. A NEW card endpoint that hands
 * Satori a string fails here by default rather than passing by omission, which
 * matters more than usual for this bug: the broken form returns 200 image/png
 * at the right dimensions, so a status check, a content-type check and "did a
 * PNG come back" all pass while the card is blank.
 *
 * ON ITS FIRST RUN THIS GUARD WAS WRONG AND THE CODE WAS RIGHT. It reported
 * api/_lib/satori-html.ts as an offender — matching the construction written
 * out in that file's own docstring, which exists to explain the bug. A file
 * that documents its own marker is exactly the file this bites. Hence
 * stripComments(), and hence the two cases below that prove the scanner stays
 * SILENT on a mention in a comment: a guard needs proof it does not fire as
 * much as proof that it does, or the only way to go green is to stop writing
 * the docs.
 */
function stripComments(src: string): string {
  return (
    src
      // Block comments. Non-greedy, so it stops at the FIRST close — a greedy
      // match here is how a "purely additive" edit silently eats a file.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Whole-line // comments only. A `//` mid-line is usually inside a url
      // string, and cutting there could hide a real call site downstream.
      .replace(/^[ \t]*\/\/.*$/gm, '')
  );
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** The source text of the first argument, by balanced-paren scan. */
function firstArgument(src: string, openParenIndex: number): string {
  let depth = 0;
  for (let i = openParenIndex; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return src.slice(openParenIndex + 1, i);
    } else if (ch === ',' && depth === 1) return src.slice(openParenIndex + 1, i);
  }
  return src.slice(openParenIndex + 1);
}

const NEEDLE = 'new ImageResponse(';

/** Offending first-arguments in one source text. */
function rawImageResponseArgs(source: string): string[] {
  const src = stripComments(source);
  const bad: string[] = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(NEEDLE, from);
    if (at === -1) break;
    const arg = firstArgument(src, at + NEEDLE.length - 1);
    if (!arg.includes('htmlToSatori(')) bad.push(arg.trim());
    from = at + NEEDLE.length;
  }
  return bad;
}

describe('every ImageResponse under api/ is handed an element tree', () => {
  it('fires on a raw string argument', () => {
    expect(rawImageResponseArgs('return new ImageResponse(html as any, { width: 1200 });')).toEqual(['html as any']);
  });

  it('stays silent on the converted form', () => {
    expect(rawImageResponseArgs('return new ImageResponse(htmlToSatori(html) as any, { width: 1200 });')).toEqual([]);
  });

  it('stays silent on a construction written out inside a comment', () => {
    expect(rawImageResponseArgs('/** `new ImageResponse(htmlString as any)` does not work. */')).toEqual([]);
    expect(rawImageResponseArgs('  // new ImageResponse(html as any) was the bug\n')).toEqual([]);
  });

  it('finds call sites at all — a guard that scans nothing always passes', () => {
    const withCalls = tsFilesUnder(join(process.cwd(), 'api')).filter((f) =>
      stripComments(readFileSync(f, 'utf8')).includes(NEEDLE),
    );
    expect(withCalls.length).toBeGreaterThan(0);
  });

  it('has no raw-string ImageResponse anywhere under api/', () => {
    const offenders: string[] = [];
    for (const file of tsFilesUnder(join(process.cwd(), 'api'))) {
      for (const arg of rawImageResponseArgs(readFileSync(file, 'utf8'))) {
        offenders.push(`${file.slice(process.cwd().length + 1)}: new ImageResponse(${arg}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
