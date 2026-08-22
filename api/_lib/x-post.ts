/**
 * X (Twitter) post-length arithmetic.
 *
 * WHY THIS EXISTS: `postText.slice(0, 280)` is not a 280-character X post.
 * JavaScript's `.length` counts UTF-16 code units; X counts *weighted*
 * characters — most code points outside the Latin/punctuation ranges weigh
 * 2, and every URL is normalised to a fixed t.co length regardless of how
 * long it actually is.
 *
 * The daily brief opens with "☕ " and includes "📍 " — each of those emoji
 * weighs 2, not 1 — and ends with a link that weighs 23, not 20. A string
 * sliced to 280 JS characters therefore arrives at X measuring well over
 * 280, and Buffer rejects the whole post with:
 *
 *   "Invalid post: Twitter / X posts cannot exceed 280 characters."
 *
 * Observed in production in brief_delivery_log on 2026-08-21.
 *
 * Weight table is X's published configuration v3.
 */

/** X normalises every link to this length, however long the real URL is. */
export const TCO_LENGTH = 23;

/** X's default post limit, in weighted characters. */
export const X_POST_LIMIT = 280;

/**
 * Code-point ranges that weigh 1. Everything else weighs 2.
 * Source: X's text-configuration v3 `ranges` with weight 100 (scaled to 1).
 */
const WEIGHT_ONE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

/**
 * Matches what X will auto-link: an optional scheme, a dotted host with a
 * plausible TLD, and an optional path. Deliberately conservative — a false
 * positive costs us a few characters of headroom, a false negative costs
 * the entire post.
 */
const URL_RE = /(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;

function codePointWeight(cp: number): number {
  for (const [lo, hi] of WEIGHT_ONE_RANGES) {
    if (cp >= lo && cp <= hi) return 1;
  }
  return 2;
}

/** Weighted length of a run of text containing no URLs. */
function plainWeight(text: string): number {
  let total = 0;
  for (const ch of text) {
    total += codePointWeight(ch.codePointAt(0) as number);
  }
  return total;
}

/**
 * Split into alternating plain-text and URL segments, in order.
 * Exported for the truncator; not part of the public contract.
 */
function segment(text: string): Array<{ text: string; isUrl: boolean }> {
  const out: Array<{ text: string; isUrl: boolean }> = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start), isUrl: false });
    out.push({ text: m[0], isUrl: true });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), isUrl: false });
  return out;
}

/**
 * How long X will consider this post. Use this, never `.length`.
 */
export function xWeightedLength(text: string): number {
  return segment(text).reduce((sum, s) => sum + (s.isUrl ? TCO_LENGTH : plainWeight(s.text)), 0);
}

/**
 * Truncate `text` so that `xWeightedLength` of the result is <= `limit`.
 *
 * Cuts on code-point boundaries (never mid-surrogate-pair), treats each URL
 * atomically (a link that will not fit is dropped whole rather than left as
 * a broken fragment), and appends an ellipsis when it actually removed
 * something — the ellipsis is included in the budget, not added on top.
 */
export function truncateForX(text: string, limit: number = X_POST_LIMIT): string {
  if (xWeightedLength(text) <= limit) return text;

  const ELLIPSIS = '…';
  const budget = limit - plainWeight(ELLIPSIS);
  if (budget <= 0) return '';

  let used = 0;
  let out = '';

  for (const seg of segment(text)) {
    if (seg.isUrl) {
      if (used + TCO_LENGTH > budget) break;
      used += TCO_LENGTH;
      out += seg.text;
      continue;
    }
    let stop = false;
    for (const ch of seg.text) {
      const w = codePointWeight(ch.codePointAt(0) as number);
      if (used + w > budget) {
        stop = true;
        break;
      }
      used += w;
      out += ch;
    }
    if (stop) break;
  }

  return out.trimEnd() + ELLIPSIS;
}
