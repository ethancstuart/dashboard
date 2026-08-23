/**
 * Mechanical grounding check — is every number in the draft actually in the data?
 *
 * WHY THIS EXISTS. A domain review traced every factual claim in five published
 * briefs back to their inputs, and none survived: "ACLED reports 400+ civilian
 * casualties" (ACLED has never been contacted), a WHO Director-General
 * statement absent from the context, an invented Turkish-brokered ceasefire,
 * "oil spiked 15% in 48h" (a false precedent hardcoded into the prompt and
 * reproduced verbatim). The prompt fixes shipped on 2026-08-23 close the
 * instructions that DEMANDED fabrication — but an instruction is not a gate.
 * This is the gate.
 *
 * THE DESIGN PRINCIPLE: numerals only, checked hard; nothing else. Proper-noun
 * grounding sounds stronger and is where a checker starts inventing findings —
 * sentence-initial capitals, demonyms, multi-word names split across lines. A
 * guard that manufactures false positives gets bypassed, and a bypassed guard
 * is worse than none (see docs: "a red light isn't a verified one"). A number
 * that appears in the draft and nowhere in the evidence is the highest-severity
 * fabrication class — invented casualty counts, invented prices, invented
 * percentages — and it is checkable with near-zero false positives.
 *
 * WHAT COUNTS AS GROUNDED:
 *  - the number appears in the context (after normalisation: commas stripped,
 *    currency/percent markers ignored)
 *  - or it is the integer rounding / truncation of a context number
 *  - or it is the absolute difference or sum of two context numbers — "jumped
 *    9 points" is legitimate when the context holds 52 and 61
 *  - years and dates adjacent to today are exempt, as are small counting
 *    numbers (0-12) which prose uses structurally ("three things to watch").
 */

export interface GroundingReport {
  /** Numerals found in the draft, normalised. */
  draftNumerals: number[];
  /** The ones with no support in the context. */
  unsupported: number[];
  /** unsupported / draftNumerals (0 when the draft has no numerals). */
  unsupportedRate: number;
  /** The verdict the publish gate should use. */
  pass: boolean;
}

/** Pull normalised numerals out of prose. */
export function extractNumerals(text: string): number[] {
  const out: number[] = [];
  // 2,136 · 134.54 · 15% · $130 · 400+ — strip markers, keep magnitude
  const re = /(?<![\w.])\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?=%|\+|\b)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = Number.parseFloat(m[1].replace(/,/g, ''));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** Structural numbers prose uses without needing evidence. */
function isExempt(v: number): boolean {
  if (v >= 0 && v <= 12 && Number.isInteger(v)) return true; // counting numbers
  // Any plausible year. A bare year is never the fabrication payload — the
  // invented figure beside it is — and the brief's no-self-history rule already
  // bans retrospective claims wholesale. Flagging years would only add the
  // false positives that get a gate bypassed.
  if (v >= 1900 && v <= 2035 && Number.isInteger(v)) return true;
  if (v === 24 || v === 48 || v === 72 || v === 100) return true; // hour windows, percent base
  return false;
}

/** Every value derivable from the context: the numbers, their roundings, pairwise sums/diffs. */
function supportSet(contextNumerals: number[]): Set<number> {
  const s = new Set<number>();
  const add = (v: number) => {
    s.add(Math.round(v * 100) / 100);
    s.add(Math.round(v * 10) / 10);
    s.add(Math.round(v));
    s.add(Math.trunc(v));
  };
  for (const v of contextNumerals) add(v);
  // Pairwise sums and absolute differences — "jumped 9" from 52 and 61.
  // Context is a few hundred numerals at most, so n^2 is fine; cap defensively.
  const capped = contextNumerals.slice(0, 400);
  for (let i = 0; i < capped.length; i++) {
    for (let j = i + 1; j < capped.length; j++) {
      add(Math.abs(capped[i] - capped[j]));
      add(capped[i] + capped[j]);
    }
  }
  return s;
}

function supported(v: number, support: Set<number>): boolean {
  if (isExempt(v)) return true;
  for (const candidate of [Math.round(v * 100) / 100, Math.round(v * 10) / 10, Math.round(v), Math.trunc(v)]) {
    if (support.has(candidate)) return true;
  }
  return false;
}

/**
 * Ground a draft against the evidence it was generated from.
 *
 * THE GATE IS RATE-LED WITH AN ABSOLUTE FLOOR, and the calibration comes from
 * a live smoke test rather than intuition: today's real brief carries 88
 * numerals, so a small absolute threshold would let four benign roundings sink
 * an entirely grounded issue — a false positive, and false positives are how a
 * gate gets bypassed. The published fabrications this exists to stop were
 * dense: several invented figures inside short passages, i.e. HIGH RATE.
 *
 * Fail when: rate > 25% (invention-dense), or at least 4 unsupported AND rate
 * > 10% (several inventions in a long brief). One or two strays in a
 * number-heavy brief pass — and are still recorded, because the metric is
 * watched per issue either way.
 */
export function groundDraft(draft: string, context: string): GroundingReport {
  const draftNumerals = extractNumerals(draft);
  const support = supportSet(extractNumerals(context));
  const unsupported = draftNumerals.filter((v) => !supported(v, support));
  const unsupportedRate = draftNumerals.length === 0 ? 0 : unsupported.length / draftNumerals.length;
  const pass = !(unsupportedRate > 0.25 || (unsupported.length >= 4 && unsupportedRate > 0.1));
  return { draftNumerals, unsupported, unsupportedRate, pass };
}
