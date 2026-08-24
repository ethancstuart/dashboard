import { describe, it, expect } from 'vitest';
import {
  DAILY_SECTIONS,
  SUNDAY_SECTIONS,
  validateBriefStructure,
  extractSubject,
  normalizeHeader,
} from './brief-structure.js';

const goodDaily = [
  "## 🎯 Today's Call",
  'Iran: 62% chance of a confirmed censorship event by 2026-09-05 — +18pts vs its base rate.',
  '## 📊 Top Signal',
  '**Sudan ceasefire collapses in El Fasher** — OONI recorded 2,136 blocking measurements.',
  '## 🌍 The Board',
  "**Movers** — Sudan 61 (▲+9) — driver not identified in today's data.",
  '**What would change our mind:** an OONI confirmed-block in Chad before Friday.',
  "## 🙊 What We're Not Saying",
  '- South Korea moved 8 points; driver not identified.',
  '## 🧨 The Long Fuse',
  'NGN has closed lower for six consecutive weeks.',
].join('\n\n');

describe('validateBriefStructure — the fixtures the restructure ships behind', () => {
  it('passes a draft with exactly the required sections, in order, with the clause', () => {
    const r = validateBriefStructure(goodDaily, false);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
    expect(r.misordered).toBe(false);
    expect(r.pass).toBe(true);
  });

  it('FAILS a draft that resurrects a killed section (Scenario Spotlight)', () => {
    const r = validateBriefStructure(goodDaily + '\n\n## 🔮 Scenario Spotlight\n\nWhat if Hormuz closes?', false);
    expect(r.extra).toEqual(['scenario spotlight']);
    expect(r.pass).toBe(false);
  });

  it('FAILS a draft missing a required section', () => {
    const r = validateBriefStructure(goodDaily.replace("## 🙊 What We're Not Saying", '## Something Else'), false);
    expect(r.missing).toEqual(['what were not saying']);
    expect(r.pass).toBe(false);
  });

  it('FAILS a reordered draft', () => {
    const swapped = goodDaily
      .replace('## 📊 Top Signal', '## TMP')
      .replace("## 🎯 Today's Call", '## 📊 Top Signal')
      .replace('## TMP', "## 🎯 Today's Call");
    const r = validateBriefStructure(swapped, false);
    expect(r.misordered).toBe(true);
    expect(r.pass).toBe(false);
  });

  it('FAILS when The Board omits the what-would-change-our-mind clause', () => {
    const r = validateBriefStructure(goodDaily.replace('**What would change our mind:**', '**Note:**'), false);
    expect(r.missingChangeOurMind).toBe(true);
    expect(r.pass).toBe(false);
  });

  it('tolerates emoji and apostrophe variance — that is not a structural defect', () => {
    const variant = goodDaily
      .replace("## 🎯 Today's Call", '## Today’s Call')
      .replace('## 🧨 The Long Fuse', '## 🕰 The Long Fuse');
    expect(validateBriefStructure(variant, false).pass).toBe(true);
  });

  it('validates the Sunday sequence with the same rules', () => {
    const sunday = SUNDAY_SECTIONS.map((s) => `${s}\n\nBody. **What would change our mind:** a resolved call.`).join(
      '\n\n',
    );
    expect(validateBriefStructure(sunday, true).pass).toBe(true);
    expect(validateBriefStructure(sunday, false).pass).toBe(false); // wrong variant is a failure, not a shrug
  });
});

describe('normalizeHeader', () => {
  it('strips emoji, case and apostrophes but keeps the words', () => {
    expect(normalizeHeader("🎯 Today's Call")).toBe('todays call');
    expect(normalizeHeader('The Board: Weekly View')).toBe('the board weekly view');
  });
});

describe('extractSubject — the subject is the story, not the date', () => {
  it('takes the first bold phrase of Top Signal', () => {
    expect(extractSubject(goodDaily)).toBe('Sudan ceasefire collapses in El Fasher');
  });

  it('returns null on a draft with no bold anywhere near the lead sections', () => {
    expect(extractSubject('## 📊 Top Signal\n\nA quiet day.')).toBeNull();
  });
});

describe('section constants', () => {
  it('daily and Sunday both carry the accountability spine', () => {
    for (const list of [DAILY_SECTIONS, SUNDAY_SECTIONS]) {
      expect(list.some((s) => s.includes('Call'))).toBe(true);
      expect(list.some((s) => s.includes("What We're Not Saying"))).toBe(true);
    }
  });
});
