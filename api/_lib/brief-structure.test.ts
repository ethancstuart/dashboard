import { describe, it, expect } from 'vitest';
import {
  DAILY_SECTIONS,
  SUNDAY_SECTIONS,
  validateBriefStructure,
  extractSubject,
  normalizeHeader,
  parseDeclaredSubject,
  isUsableSubject,
  chooseSubject,
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

  it('NEVER crosses a section boundary — the bug that titled an issue "Movers"', () => {
    // Top Signal has no bold; the next section opens with a bold subsection
    // label. The 2026-08-24 issue went out with the subject "Movers" because
    // a fixed-width window read into The Board. The extractor must fall
    // through to Today's Call instead.
    const draft = [
      "## 🎯 Today's Call",
      '**Thailand**: 52% chance by 2026-09-05.',
      '## 📊 Top Signal',
      'Russia and Iran are running parallel censorship operations at scale.',
      '## 🌍 The Board',
      '**Movers** — Sudan 61.',
    ].join('\n\n');
    expect(extractSubject(draft)).toBe('Thailand');
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

describe('subject lines — declared, validated, clamped', () => {
  it('parses a declared SUBJECT line and STRIPS it from the body', () => {
    const draft = 'SUBJECT: Russia and Iran hit record censorship this week\n\n## 📊 Top Signal\n\nBody.';
    const r = parseDeclaredSubject(draft);
    expect(r.subject).toBe('Russia and Iran hit record censorship this week');
    expect(r.body.startsWith('## 📊 Top Signal')).toBe(true);
    expect(r.body).not.toContain('SUBJECT:');
  });

  it('rejects every real-world bad subject this shipped before the fix', () => {
    expect(isUsableSubject('Thailand')).toBe(false); // one word is a label
    expect(isUsableSubject('Why it matters')).toBe(false); // transition phrase
    expect(isUsableSubject('Movers')).toBe(false); // section label
    expect(isUsableSubject('The Board')).toBe(false);
    expect(isUsableSubject('**bolded**')).toBe(false); // stray markdown
    expect(isUsableSubject('')).toBe(false);
    expect(isUsableSubject(null)).toBe(false);
  });

  it('accepts a real headline', () => {
    expect(isUsableSubject('Russia and Iran hit record censorship this week')).toBe(true);
  });

  it('CLAMPS an over-long subject at a word boundary rather than discarding it', () => {
    const long = 'OFAC designated Palestine Action and Autistici Inventati as SDGTs on Tuesday';
    const r = parseDeclaredSubject(`SUBJECT: ${long}\n\n## 📊 Top Signal\n\nBody.`);
    expect(r.subject).not.toBeNull();
    expect((r.subject as string).length).toBeLessThanOrEqual(68);
    expect(r.subject).not.toMatch(/\s$/);
    expect(long.startsWith(r.subject as string)).toBe(true); // truncated, not mangled
  });

  it('falls back to extraction when the model omits the line, and to null when nothing is usable', () => {
    const noDecl = '## 📊 Top Signal\n\n**Sudan ceasefire collapses in El Fasher** — OONI recorded blocks.';
    expect(chooseSubject(null, noDecl)).toBe('Sudan ceasefire collapses in El Fasher');
    // A body whose only bold is a section label yields nothing rather than junk.
    const junk = '## 📊 Top Signal\n\nQuiet.\n\n## 🌍 The Board\n\n**Movers** — Sudan 61.';
    expect(chooseSubject(null, junk)).toBeNull();
  });

  it('prefers the declared line over a scrapeable one', () => {
    const body = '## 📊 Top Signal\n\n**Sudan ceasefire collapses in El Fasher** — blocks.';
    expect(chooseSubject('We are calling Thailand at 52% against a 70% base rate', body)).toBe(
      'We are calling Thailand at 52% against a 70% base rate',
    );
  });
});
