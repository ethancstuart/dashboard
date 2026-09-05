/**
 * HTML-string → Satori element tree.
 *
 * WHY THIS EXISTS. `new ImageResponse(htmlString as any)` DOES NOT WORK, and it
 * does not fail either — which is why it survived. Satori takes a React-element
 * shape (`{ type, props: { style, children } }`); handed a string it treats the
 * whole thing as one text node, lays the raw markup out as prose, and returns a
 * perfectly valid 1200x630 PNG. Verified against production on 2026-08-28:
 *
 *   curl https://nexuswatch.dev/api/og?type=site      → 200 image/png, 4411 B, BLANK
 *   curl https://nexuswatch.dev/api/og?type=country&iso=IR → 200, 4901 B, an Iranian
 *                                                      flag emoji alone on white
 *
 * Every check anyone would think to run — status, content-type, "does a PNG come
 * back" — passes. Only looking at the pixels shows it. This is the deployed-model
 * lesson in its purest form: the mechanism was correct-looking locally and the
 * property ("a card a human can read") was never asserted anywhere.
 *
 * The adapter, rather than rewriting every card template as nested object
 * literals: the templates are already written, already correct HTML, and already
 * reviewed. Converting them by hand is twelve opportunities to typo a colour.
 * This turns the ONE wrong assumption into one function with tests.
 *
 * THE SUBSET IT ACCEPTS is deliberately small, and anything outside it THROWS
 * rather than degrading — a silent degrade is the bug this file exists to fix:
 *   - `<div>` / `<span>` open and close tags, arbitrarily nested
 *   - a `style="..."` attribute (any other attribute is ignored, not an error —
 *     Satori has no use for them)
 *   - text content, with the HTML entities escapeHtml() produces decoded back
 *   - whitespace-only text between tags is dropped, so template indentation
 *     does not become content
 */

export type SatoriStyle = Record<string, string>;

export interface SatoriNode {
  type: string;
  props: { style?: SatoriStyle; children?: Array<SatoriNode | string> | string };
  key: null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Inverse of the escapeHtml() the card templates run their data through. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, ref: string) => {
    if (ref.startsWith('#x') || ref.startsWith('#X')) {
      const cp = Number.parseInt(ref.slice(2), 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
    }
    if (ref.startsWith('#')) {
      const cp = Number.parseInt(ref.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : match;
    }
    return NAMED_ENTITIES[ref] ?? match;
  });
}

/** `font-size:18px;color:#fff` → `{ fontSize: '18px', color: '#fff' }` */
export function parseStyle(decl: string): SatoriStyle {
  const out: SatoriStyle = {};
  for (const part of decl.split(';')) {
    const i = part.indexOf(':');
    if (i === -1) continue;
    const prop = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!prop || !value) continue;
    out[prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = decodeEntities(value);
  }
  return out;
}

// Attribute values in the card templates are always double-quoted and can never
// contain a bare `"`, because every interpolated value goes through escapeHtml.
const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
const STYLE_ATTR = /\bstyle\s*=\s*"([^"]*)"/;
const VOID_TAGS = new Set(['br', 'img', 'hr']);

/**
 * Convert one well-formed HTML fragment with a single root element into the
 * element shape Satori accepts. Throws on unbalanced tags — a card that cannot
 * be parsed must not quietly render as something else.
 */
export function htmlToSatori(html: string): SatoriNode {
  const roots: Array<SatoriNode | string> = [];
  const stack: SatoriNode[] = [];

  const push = (child: SatoriNode | string) => {
    const parent = stack[stack.length - 1];
    if (!parent) {
      roots.push(child);
      return;
    }
    const kids = parent.props.children as Array<SatoriNode | string>;
    kids.push(child);
  };

  const pushText = (raw: string) => {
    if (raw.trim() === '') return; // template indentation is not content
    push(decodeEntities(raw.trim()));
  };

  TOKEN.lastIndex = 0;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html)) !== null) {
    pushText(html.slice(cursor, m.index));
    cursor = TOKEN.lastIndex;

    const [, closing, tag, attrs, selfClosing] = m;
    const name = tag.toLowerCase();

    if (closing) {
      const open = stack.pop();
      if (!open || open.type !== name) {
        throw new Error(`htmlToSatori: unbalanced </${name}> (open element was ${open?.type ?? 'none'})`);
      }
      continue;
    }

    const styleMatch = attrs ? STYLE_ATTR.exec(attrs) : null;
    const node: SatoriNode = {
      type: name,
      props: { children: [] },
      key: null,
    };
    if (styleMatch) node.props.style = parseStyle(styleMatch[1]);

    push(node);
    if (!selfClosing && !VOID_TAGS.has(name)) stack.push(node);
  }
  pushText(html.slice(cursor));

  if (stack.length > 0) {
    throw new Error(`htmlToSatori: unclosed <${stack[stack.length - 1].type}>`);
  }
  const elements = roots.filter((r): r is SatoriNode => typeof r !== 'string');
  if (elements.length !== 1 || elements.length !== roots.length) {
    throw new Error(`htmlToSatori: expected exactly one root element, got ${roots.length} node(s)`);
  }
  return elements[0];
}
