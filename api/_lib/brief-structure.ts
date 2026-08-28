/**
 * The brief's section structure — one source of truth, prompt and gate alike.
 *
 * Owner decision 2026-08-23: restructure the brief around the accountability
 * loop — The Ledger (mechanical, inserted after the H1 by the template) →
 * Today's Call → Top Signal → The Board (with a mandatory "what would change
 * our mind" clause) → What We're Not Saying → The Long Fuse. Scenario
 * Spotlight is killed: an unfalsifiable hypothetical actively undermines a
 * graded product.
 *
 * The prompt builds its STRUCTURE block from these constants and the publish
 * gate validates the draft against the same constants, so the two cannot
 * drift apart (rule 5: derive, don't enumerate twice). A draft that invents,
 * drops, or reorders sections fails the gate and the deterministic fallback
 * publishes instead.
 */

/** Daily (Mon–Sat) model-written sections, in required order. */
export const DAILY_SECTIONS = [
  "## 🎯 Today's Call",
  '## 📊 Top Signal',
  '## 🌍 The Board',
  "## 🙊 What We're Not Saying",
  '## 🧨 The Long Fuse',
] as const;

/** Sunday Week-in-Review sections, in required order. */
export const SUNDAY_SECTIONS = [
  '## ☕ Good Morning',
  "## 🎯 This Week's Calls",
  '## 📍 The Week That Was',
  '## 🌍 The Board: Weekly View',
  "## 🙊 What We're Not Saying",
  '## 🔭 The Week Ahead',
] as const;

/** The clause The Board must end with — the falsifiability hook. */
export const CHANGE_OUR_MIND = 'What would change our mind';

export interface StructureReport {
  /** Normalised headers found in the draft, in order. */
  found: string[];
  /** Required sections absent from the draft. */
  missing: string[];
  /** Headers in the draft that are not part of the structure. */
  extra: string[];
  /** True when required sections appear out of order. */
  misordered: boolean;
  /** True when The Board lacks its "what would change our mind" clause. */
  missingChangeOurMind: boolean;
  pass: boolean;
}

/**
 * Compare headers on their words, not their emoji: models occasionally vary
 * an emoji or an apostrophe, and failing the whole issue over U+2019 vs U+0027
 * would be a false positive — the thing that gets a gate bypassed.
 */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

/** Validate a model draft against the required section sequence. */
export function validateBriefStructure(markdown: string, isSunday: boolean): StructureReport {
  const required = (isSunday ? SUNDAY_SECTIONS : DAILY_SECTIONS).map(normalizeHeader);
  const found = [...markdown.matchAll(/^## +(.+)$/gm)].map((m) => normalizeHeader(m[1]));

  const missing = required.filter((r) => !found.includes(r));
  const extra = found.filter((f) => !required.includes(f));

  // Order check on the required sections that ARE present.
  const presentInOrder = found.filter((f) => required.includes(f));
  const expectedOrder = required.filter((r) => presentInOrder.includes(r));
  const misordered = presentInOrder.join('|') !== expectedOrder.join('|');

  // The Board's falsifiability clause. Checked against the whole draft rather
  // than parsed out of the section: the clause string is distinctive enough,
  // and section-boundary parsing is where a checker starts inventing findings.
  const missingChangeOurMind = !markdown.toLowerCase().includes(CHANGE_OUR_MIND.toLowerCase());

  return {
    found,
    missing,
    extra,
    misordered,
    missingChangeOurMind,
    pass: missing.length === 0 && extra.length === 0 && !misordered && !missingChangeOurMind,
  };
}

/**
 * SUBJECT LINES — declared, not scraped.
 *
 * The first implementation extracted the opening **bold** phrase of Top
 * Signal. A bold marker is EMPHASIS, not a title, so what shipped was
 * whatever the model happened to embolden first:
 *
 *   2026-08-24  "Thailand"                                (8 chars)
 *   2026-08-25  "Thailand"                                (8)
 *   2026-08-26  "Why it matters"                          (14 — a transition phrase)
 *   2026-08-27  "Thailand censorship by 2026-09-05"       (33)
 *   2026-08-28  "OFAC designated Palestine Action and …"  (76 — truncates on a phone)
 *
 * The fix is not a better regex. It is to stop reading a side-effect and ask
 * for the thing we actually want: the prompt now requires a `SUBJECT:` line,
 * which is parsed out, validated against a floor, and stripped before the
 * gates or the reader ever see it. Scraped extraction survives only as the
 * fallback for a draft that omits the line, and the dated form as the last
 * resort — a missing subject must never block delivery.
 */

/** Emphasis phrases and structural labels that are never a story. */
const SUBJECT_BLOCKLIST = [
  /^why it matters$/i,
  /^what to watch$/i,
  /^the bottom line$/i,
  /^bottom line$/i,
  /^key takeaways?$/i,
  /^movers$/i,
  /^crises$/i,
  /^markets$/i,
  /^top signal$/i,
  /^today'?s call$/i,
  /^the board$/i,
  /^the long fuse$/i,
  /^what we'?re not saying$/i,
  /^nexuswatch/i,
];

/** Mobile clients truncate around here; below the floor it is a label. */
export const SUBJECT_MIN = 20;
export const SUBJECT_MAX = 68;

/** Trim to the last whole word inside SUBJECT_MAX. */
function clampSubject(s: string): string {
  const t = s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.:;,\s]+$/, '');
  if (t.length <= SUBJECT_MAX) return t;
  const cut = t.slice(0, SUBJECT_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > SUBJECT_MIN ? cut.slice(0, lastSpace) : cut).replace(/[.:;,\s]+$/, '');
}

/**
 * Usable as a subject? Too-long is CLAMPED rather than rejected — discarding
 * a good 70-character line to fall back on a worse source would be the
 * checker making the product worse.
 */
export function isUsableSubject(s: string | null | undefined): s is string {
  if (!s) return false;
  const t = s.trim();
  if (t.length < SUBJECT_MIN) return false;
  if (!/\s/.test(t)) return false; // one word is a label ("Thailand"), not a subject
  if (/[*_#`]/.test(t)) return false; // stray markdown
  return !SUBJECT_BLOCKLIST.some((re) => re.test(t));
}

/**
 * Pull a declared `SUBJECT:` line off a draft and return the body without it.
 * The line must never reach the reader.
 */
export function parseDeclaredSubject(markdown: string): { subject: string | null; body: string } {
  const m = markdown.match(/^[ \t]*SUBJECT:[ \t]*(.+?)[ \t]*$/im);
  if (!m) return { subject: null, body: markdown };
  const body = markdown.replace(m[0], '').replace(/^\s*\n/, '');
  const candidate = m[1].replace(/^["'“”]|["'“”]$/g, '').trim();
  return { subject: isUsableSubject(candidate) ? clampSubject(candidate) : null, body };
}

/**
 * The subject to ship: the model's declared line if usable, else one scraped
 * from the lead sections, else null (caller uses the dated fallback).
 */
export function chooseSubject(declared: string | null, body: string): string | null {
  if (isUsableSubject(declared)) return clampSubject(declared);
  const scraped = extractSubject(body);
  return isUsableSubject(scraped) ? clampSubject(scraped) : null;
}

export function extractSubject(markdown: string): string | null {
  for (const section of ['Top Signal', "Today's Call", "This Week's Calls", 'The Week That Was']) {
    const idx = markdown.indexOf(section);
    if (idx === -1) continue;
    // The window ends at the NEXT section header, never at a fixed offset.
    // The first live run proved why: Top Signal opened without a bold
    // phrase, a 1200-char window ran into The Board, and the 2026-08-24
    // subject line went out as "Movers" — a subsection label from a
    // different section entirely.
    const rest = markdown.slice(idx + section.length);
    const nextHeader = rest.search(/^## /m);
    const tail = nextHeader === -1 ? rest : rest.slice(0, nextHeader);
    const bold = tail.match(/\*\*([^*\n]{4,90})\*\*/);
    if (bold) {
      const s = bold[1].trim().replace(/[.:]$/, '');
      if (s.length >= 4) return s;
    }
  }
  return null;
}
