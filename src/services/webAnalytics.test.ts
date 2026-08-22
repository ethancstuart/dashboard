import { describe, it, expect } from 'vitest';
import { computeHashRoute, currentHashPath } from './webAnalytics.ts';

describe('currentHashPath', () => {
  it('strips the leading hash', () => {
    expect(currentHashPath('#/intel')).toBe('/intel');
  });

  it('defaults an empty hash to root', () => {
    expect(currentHashPath('')).toBe('/');
  });

  it('drops the query string — it is not part of the route', () => {
    expect(currentHashPath('#/briefs?date=2026-08-22')).toBe('/briefs');
  });

  it('always returns a leading slash', () => {
    expect(currentHashPath('#intel')).toBe('/intel');
  });
});

describe('computeHashRoute', () => {
  it('leaves a static route alone', () => {
    expect(computeHashRoute('/intel')).toBe('/intel');
    expect(computeHashRoute('/')).toBe('/');
  });

  it('parameterises country codes', () => {
    expect(computeHashRoute('/country/US')).toBe('/country/[code]');
    expect(computeHashRoute('/country/GBR')).toBe('/country/[code]');
  });

  it('parameterises dates', () => {
    expect(computeHashRoute('/briefs/2026-08-22')).toBe('/briefs/[date]');
  });

  it('parameterises numeric and uuid ids', () => {
    expect(computeHashRoute('/post/12345')).toBe('/post/[id]');
    expect(computeHashRoute('/run/3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe('/run/[id]');
  });

  it('does not mangle ordinary lowercase route names', () => {
    for (const r of ['/intel', '/portfolio', '/briefs', '/case-study', '/data-lab', '/settings']) {
      expect(computeHashRoute(r)).toBe(r);
    }
  });

  it('normalises a route it has never seen — derived, not enumerated', () => {
    // The point of the shape rules: a route added later needs no edit here.
    expect(computeHashRoute('/some-future-page/FR')).toBe('/some-future-page/[code]');
    expect(computeHashRoute('/another/new/2026-01-01')).toBe('/another/new/[date]');
  });

  it('groups every concrete value of one route to a single pattern', () => {
    const patterns = new Set(['US', 'GB', 'FRA', 'JP'].map((c) => computeHashRoute(`/country/${c}`)));
    expect(patterns.size).toBe(1);
  });
});
