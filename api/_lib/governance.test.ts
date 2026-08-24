import { describe, it, expect } from 'vitest';
import { governanceFromWgi } from './governance.js';

describe('governanceFromWgi — anchored to the observed range', () => {
  it('Denmark-tier (+1.8) → 0, Somalia-tier (−1.92) → ~14.7, worse clamps at 15', () => {
    expect(governanceFromWgi(1.8)).toBe(0);
    expect(governanceFromWgi(2.5)).toBe(0); // better than the anchor stays 0
    expect(governanceFromWgi(-1.92)).toBeCloseTo(14.7, 1);
    expect(governanceFromWgi(-2.5)).toBe(15); // clamped
  });

  it('mid-governance lands mid-scale — the property the sparse table lacked', () => {
    const mid = governanceFromWgi(0);
    expect(mid).toBeGreaterThan(6);
    expect(mid).toBeLessThan(8.5);
  });

  it('is monotone decreasing in governance quality', () => {
    const pts = [1.5, 0.5, -0.5, -1.5].map(governanceFromWgi);
    for (let i = 1; i < pts.length; i++) expect(pts[i]).toBeGreaterThan(pts[i - 1]);
  });
});
