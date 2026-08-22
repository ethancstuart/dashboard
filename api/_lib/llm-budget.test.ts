import { describe, it, expect } from 'vitest';
import { anthropicFamily, estimateAnthropicCost } from './llm-budget.js';

describe('anthropicFamily', () => {
  it('recognises the model ids actually used in this repo', () => {
    expect(anthropicFamily('claude-sonnet-4-5-20250929')).toBe('sonnet');
    expect(anthropicFamily('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(anthropicFamily('claude-opus-4-5-20250101')).toBe('opus');
  });

  it('is case-insensitive', () => {
    expect(anthropicFamily('Claude-Sonnet-4-5')).toBe('sonnet');
  });

  it('prices an UNKNOWN model as opus — the expensive direction, on purpose', () => {
    // This feeds a kill-switch. Over-estimating trips the cap early and
    // someone looks; under-estimating lets real spend through invisibly.
    expect(anthropicFamily('claude-something-new-2027')).toBe('opus');
    expect(anthropicFamily('')).toBe('opus');
  });

  it('never returns a family cheaper than reality for a future model', () => {
    const unknownCost = estimateAnthropicCost(anthropicFamily('claude-mystery-9'), {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    for (const known of ['sonnet', 'haiku'] as const) {
      const knownCost = estimateAnthropicCost(known, {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      });
      expect(unknownCost).toBeGreaterThanOrEqual(knownCost);
    }
  });
});

describe('estimateAnthropicCost', () => {
  it('prices sonnet input and output at the published rates', () => {
    expect(estimateAnthropicCost('sonnet', { input_tokens: 1_000_000 })).toBeCloseTo(3, 6);
    expect(estimateAnthropicCost('sonnet', { output_tokens: 1_000_000 })).toBeCloseTo(15, 6);
  });

  it('prices cached input far below fresh input', () => {
    const fresh = estimateAnthropicCost('sonnet', { input_tokens: 1_000_000 });
    const cached = estimateAnthropicCost('sonnet', { cached_input_tokens: 1_000_000 });
    expect(cached).toBeLessThan(fresh);
  });

  it('returns 0 for an empty usage block rather than NaN', () => {
    expect(estimateAnthropicCost('haiku', {})).toBe(0);
  });

  it('orders the families haiku < sonnet < opus', () => {
    const u = { input_tokens: 100_000, output_tokens: 100_000 };
    expect(estimateAnthropicCost('haiku', u)).toBeLessThan(estimateAnthropicCost('sonnet', u));
    expect(estimateAnthropicCost('sonnet', u)).toBeLessThan(estimateAnthropicCost('opus', u));
  });
});
