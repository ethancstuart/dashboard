import { describe, it, expect } from 'vitest';
import { xWeightedLength, truncateForX, TCO_LENGTH, X_POST_LIMIT } from './x-post.js';

describe('xWeightedLength', () => {
  it('counts plain ASCII the same as String.length', () => {
    const s = 'the quick brown fox jumps over the lazy dog';
    expect(xWeightedLength(s)).toBe(s.length);
  });

  it('weighs emoji as 2, not 1 — this is the whole bug', () => {
    expect(xWeightedLength('☕')).toBe(2);
    expect(xWeightedLength('📍')).toBe(2);
    // '📍' is a surrogate pair: String.length lies in the other direction.
    expect('📍'.length).toBe(2);
    expect(xWeightedLength('→')).toBe(2);
  });

  it('normalises any URL to t.co length', () => {
    expect(xWeightedLength('brief.nexuswatch.dev')).toBe(TCO_LENGTH);
    expect(xWeightedLength('https://nexuswatch.dev/briefs/2026-08-22/full-text')).toBe(TCO_LENGTH);
  });

  it('mixes plain runs and URLs additively', () => {
    expect(xWeightedLength('read nexuswatch.dev now')).toBe('read '.length + TCO_LENGTH + ' now'.length);
  });
});

describe('the production failure it reproduces', () => {
  // Shape of the real Buffer post: emoji-led sections plus a trailing link.
  // brief_delivery_log recorded Buffer rejecting this on 2026-08-21 with
  // "Twitter / X posts cannot exceed 280 characters" despite .slice(0, 280).
  function buildPost(goodMorning: string, topStory: string): string {
    return [`☕ ${goodMorning.slice(0, 220)}`, `\n\n📍 ${topStory}`, `\n\nFull brief → brief.nexuswatch.dev`].join('');
  }

  const post = buildPost('m'.repeat(220), 's'.repeat(180));

  it('proves .slice(0, 280) produces a post X measures as over the limit', () => {
    const legacy = post.slice(0, 280);
    expect(legacy.length).toBe(280);
    expect(xWeightedLength(legacy)).toBeGreaterThan(X_POST_LIMIT);
  });

  it('truncateForX produces one X will accept', () => {
    expect(xWeightedLength(truncateForX(post))).toBeLessThanOrEqual(X_POST_LIMIT);
  });
});

describe('truncateForX', () => {
  it('leaves a post that already fits completely untouched', () => {
    const s = 'a short brief line';
    expect(truncateForX(s)).toBe(s);
  });

  it('never exceeds the limit, across a sweep of lengths and emoji density', () => {
    for (let n = 1; n <= 400; n += 7) {
      for (const filler of ['a', '☕', '📍', 'aa☕']) {
        const s = filler.repeat(n) + ' tail nexuswatch.dev';
        expect(xWeightedLength(truncateForX(s))).toBeLessThanOrEqual(X_POST_LIMIT);
      }
    }
  });

  it('respects a custom limit', () => {
    const s = 'x'.repeat(500);
    expect(xWeightedLength(truncateForX(s, 100))).toBeLessThanOrEqual(100);
  });

  it('never splits a surrogate pair', () => {
    for (let n = 100; n <= 200; n++) {
      const out = truncateForX('📍'.repeat(300), n);
      // A lone surrogate would land in D800-DFFF.
      for (const unit of [...out].map((c) => c.codePointAt(0) as number)) {
        expect(unit < 0xd800 || unit > 0xdfff).toBe(true);
      }
    }
  });

  it('drops a trailing URL whole rather than leaving a broken fragment', () => {
    const out = truncateForX('y'.repeat(275) + ' nexuswatch.dev/briefs');
    expect(out).not.toContain('nexuswatch');
    expect(xWeightedLength(out)).toBeLessThanOrEqual(X_POST_LIMIT);
  });

  it('marks that it truncated', () => {
    expect(truncateForX('z'.repeat(400)).endsWith('…')).toBe(true);
  });
});
