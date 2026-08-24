import { describe, it, expect } from 'vitest';
import { parseCsv, parseUcdpCsv, conflictBaselineFromDeaths, extractCandidateUrls, GW_TO_ISO2 } from './ucdp.js';

describe('parseCsv — the dialect UCDP actually ships', () => {
  it('handles embedded commas, doubled quotes, and NEWLINES inside quotes', () => {
    const text = 'a,b,c\n1,"x, y",plain\n2,"line one\nline two","say ""hi"""\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'plain'],
      ['2', 'line one\nline two', 'say "hi"'],
    ]);
  });

  it('handles CRLF and a missing trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseUcdpCsv', () => {
  const csv = [
    'id,relid,year,type_of_violence,country,country_id,latitude,longitude,date_start,date_end,best',
    '635781,AFG-1,2026,3,Afghanistan,700,33.49,64.36,2026-07-11 00:00:00.000,2026-07-11,4',
    '635782,UKR-1,2026,1,Ukraine,369,48.4,31.2,2026-07-12 00:00:00.000,2026-07-12,12',
    '635783,XX-1,2026,1,Ruritania,999,0,0,2026-07-13 00:00:00.000,2026-07-13,1',
  ].join('\n');

  it('reads by header name, maps GW codes to ISO-2, trims timestamps to dates', () => {
    const { events, unmappedGwCodes } = parseUcdpCsv(csv);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ eventId: 635781, iso2: 'AF', dateStart: '2026-07-11', deathsBest: 4 });
    expect(events[1].iso2).toBe('UA');
    expect(events[2].iso2).toBeNull(); // unmapped GW code is kept, not dropped
    expect(unmappedGwCodes.get(999)).toBe(1);
  });

  it('throws on a file whose columns are not what we assume — never silently misreads', () => {
    expect(() => parseUcdpCsv('foo,bar\n1,2')).toThrow(/ucdp_csv_missing_columns/);
  });
});

describe('conflictBaselineFromDeaths — measured input, documented scale', () => {
  it('anchors: 0 → 0, 100/yr ≈ 4, 1k ≈ 9, ~3k ≈ 12, ≥100k caps at 20', () => {
    expect(conflictBaselineFromDeaths(0)).toBe(0);
    expect(conflictBaselineFromDeaths(100)).toBeGreaterThan(3);
    expect(conflictBaselineFromDeaths(100)).toBeLessThan(5);
    expect(conflictBaselineFromDeaths(1000)).toBeGreaterThan(8);
    expect(conflictBaselineFromDeaths(1000)).toBeLessThan(10);
    expect(conflictBaselineFromDeaths(3123)).toBeGreaterThan(11);
    expect(conflictBaselineFromDeaths(3123)).toBeLessThan(13);
    expect(conflictBaselineFromDeaths(100_000)).toBe(20);
    expect(conflictBaselineFromDeaths(5_000_000)).toBe(20); // capped
  });

  it('is monotone', () => {
    const points = [1, 5, 50, 500, 5000, 50000].map(conflictBaselineFromDeaths);
    for (let i = 1; i < points.length; i++) expect(points[i]).toBeGreaterThan(points[i - 1]);
  });
});

describe('extractCandidateUrls — derived from the page, never a hardcoded version', () => {
  it('finds candidate CSV links and ignores xlsx/codebook/zip', () => {
    const html = `
      <a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_7.csv">csv</a>
      <a href="https://ucdp.uu.se/downloads/candidateged/GEDevent_v26_0_7.xlsx">x</a>
      <a href="https://ucdp.uu.se/downloads/candidateged/ucdp-candidate-codebook1.5.pdf">c</a>
      <a href="https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_01_26_06.csv">combined</a>
      <a href="https://ucdp.uu.se/downloads/ged/ged261-csv.zip">annual</a>`;
    expect(extractCandidateUrls(html)).toEqual([
      'https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_7.csv',
      'https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_01_26_06.csv',
    ]);
  });
});

describe('GW_TO_ISO2 sanity', () => {
  it('covers the heavy-conflict countries the feed actually reports', () => {
    for (const [gw, iso] of [
      [369, 'UA'],
      [625, 'SD'],
      [775, 'MM'],
      [490, 'CD'],
      [666, 'IL'],
      [100, 'CO'],
      [770, 'PK'],
    ] as const) {
      expect(GW_TO_ISO2[gw]).toBe(iso);
    }
  });
});
