import { describe, it, expect } from 'vitest';
import { buildBriefEntries, isoDate } from './sitemap.js';

/**
 * THE BRIEF ARCHIVE WAS INVISIBLE TO SEARCH ENGINES FOR MONTHS.
 *
 * Measured on the live sitemap 2026-08-30: 950 URLs, ZERO of them a brief,
 * while 140 briefs existed and /brief/2026-08-27 returned 200.
 *
 * Cause: `@neondatabase/serverless` returns `date` and `timestamptz` columns
 * as JS Date objects. The query selected `generated_at` without `::text`, so
 * `generated_at.slice(0, 10)` threw a TypeError into a soft-fail catch and the
 * whole section silently produced nothing. Had it not thrown, the second bug
 * would have rendered `/brief/Sun Aug 30 2026 00:00:00 GMT-0700 ...`.
 *
 * These tests feed the builder BOTH shapes the driver can produce, so a
 * dropped cast fails here rather than quietly emptying a sitemap for months.
 */
describe('brief sitemap entries survive whatever the driver returns', () => {
  const base = 'https://nexuswatch.dev';

  it('builds clean URLs from text columns (the cast working)', () => {
    const out = buildBriefEntries([{ brief_date: '2026-08-27', generated_at: '2026-08-27T10:00:19.235Z' }], base);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('<loc>https://nexuswatch.dev/brief/2026-08-27</loc>');
    expect(out[0]).toContain('<lastmod>2026-08-27</lastmod>');
  });

  it('builds clean URLs from Date columns (the cast dropped)', () => {
    // The exact regression: both columns arrive as Dates.
    const out = buildBriefEntries(
      [{ brief_date: new Date(2026, 7, 30), generated_at: new Date(2026, 7, 30, 3, 1, 13) }],
      base,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('<loc>https://nexuswatch.dev/brief/2026-08-30</loc>');
    // Never a stringified Date in a <loc>.
    expect(out[0]).not.toMatch(/GMT|Sun |Mon |Aug /);
  });

  it('never emits a malformed loc', () => {
    const out = buildBriefEntries(
      [
        { brief_date: 'not-a-date', generated_at: null },
        { brief_date: '', generated_at: null },
        { brief_date: '2026-08-27', generated_at: null },
      ],
      base,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('/brief/2026-08-27');
  });

  it('falls back to the brief date when generated_at is missing', () => {
    const out = buildBriefEntries([{ brief_date: '2026-08-27', generated_at: null }], base);
    expect(out[0]).toContain('<lastmod>2026-08-27</lastmod>');
  });

  it('does not read the UTC date off a local Date', () => {
    // 2026-08-30 late evening local, west of Greenwich, is 2026-08-31 UTC.
    // toISOString().slice(0,10) would advertise tomorrow's brief — the same
    // off-by-one class this project has already shipped once.
    const late = new Date(2026, 7, 30, 23, 30, 0);
    expect(isoDate(late)).toBe('2026-08-30');
  });

  it('produces one entry per brief — the archive is advertised in full', () => {
    const rows = Array.from({ length: 140 }, (_, i) => ({
      brief_date: new Date(2026, 3, 8 + i),
      generated_at: null,
    }));
    expect(buildBriefEntries(rows, base)).toHaveLength(140);
  });
});
