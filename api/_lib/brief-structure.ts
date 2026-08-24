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
 * The email subject, extracted mechanically from the draft.
 *
 * "NexusWatch Intelligence Brief — 2026-08-22" promises nothing; the first
 * bold phrase of Top Signal is the day's actual story. Falls back through
 * Today's Call before giving up, and the caller keeps the dated subject as
 * the final fallback — a missing subject must never block delivery.
 */
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
