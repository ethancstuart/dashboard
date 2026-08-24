import { describe, it, expect } from 'vitest';
import {
  parseCsvLine,
  parseOfacCsv,
  parseUnXml,
  ofacProgramCountries,
  unListTypeCountry,
  diffSnapshot,
  fingerprint,
} from './sanctions.js';

describe('parseCsvLine — the SDN.CSV dialect', () => {
  it('handles quoted fields with commas and the -0- null marker', () => {
    expect(parseCsvLine('173,"ANGLO-CARIBBEAN CO., LTD.",-0- ,"CUBA",-0- ,-0- ')).toEqual([
      '173',
      'ANGLO-CARIBBEAN CO., LTD.',
      '',
      'CUBA',
      '',
      '',
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsvLine('1,"say ""hi""",x')).toEqual(['1', 'say "hi"', 'x']);
  });
});

describe('parseOfacCsv', () => {
  const csv = [
    '36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
    '306,"BANCO NACIONAL DE CUBA",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"a.k.a. \'BNC\'."',
    '9001,"SOME PERSON","individual","IRAN; SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
    'not,a,data,row',
  ].join('\n');

  it('parses rows, splits programs, defaults empty type to entity', () => {
    const rows = parseOfacCsv(csv);
    expect(rows).toHaveLength(3); // the non-numeric id row is dropped
    expect(rows[0]).toMatchObject({ id: '36', name: 'AEROCARIBBEAN AIRLINES', type: 'entity', countries: ['CU'] });
    expect(rows[2]).toMatchObject({ id: '9001', type: 'individual', programs: ['IRAN', 'SDGT'], countries: ['IR'] });
  });
});

describe('regime → country attribution', () => {
  it('maps unambiguous regimes and refuses transnational ones', () => {
    expect(ofacProgramCountries(['IRAN-EO13876'])).toEqual(['IR']);
    expect(ofacProgramCountries(['SDGT'])).toEqual([]); // transnational — no guess
    expect(ofacProgramCountries(['UKRAINE-EO13662'])).toEqual([]); // deliberately unmapped
    expect(unListTypeCountry('DPRK')).toBe('KP');
    expect(unListTypeCountry('GB')).toBe('GW'); // Guinea-Bissau, not Great Britain
    expect(unListTypeCountry('Al-Qaida')).toBeNull();
  });
});

describe('parseUnXml — the fields the old parser threw away', () => {
  const xml = `
    <INDIVIDUAL>
      <DATAID>6907993</DATAID>
      <FIRST_NAME>ERIC</FIRST_NAME>
      <SECOND_NAME>BADEGE</SECOND_NAME>
      <UN_LIST_TYPE>DRC</UN_LIST_TYPE>
      <REFERENCE_NUMBER>CDi.001</REFERENCE_NUMBER>
      <LISTED_ON>2012-12-31</LISTED_ON>
    </INDIVIDUAL>
    <ENTITY>
      <DATAID>6908402</DATAID>
      <FIRST_NAME>ADF</FIRST_NAME>
      <UN_LIST_TYPE>DRC</UN_LIST_TYPE>
      <REFERENCE_NUMBER>CDe.001</REFERENCE_NUMBER>
      <LISTED_ON>2014-06-30</LISTED_ON>
    </ENTITY>`;

  it('captures UN_LIST_TYPE country, LISTED_ON date, and both node kinds', () => {
    const rows = parseUnXml(xml);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: '6907993',
      name: 'ERIC BADEGE',
      type: 'individual',
      countries: ['CD'],
      listedOn: '2012-12-31',
    });
    expect(rows[1]).toMatchObject({ id: '6908402', name: 'ADF', type: 'entity', listedOn: '2014-06-30' });
  });
});

describe('diffSnapshot — the diff the old collector faked', () => {
  const feedEntity = (id: string, name: string) => ({
    id,
    name,
    type: 'entity',
    countries: [],
    programs: ['IRAN'],
    listedOn: null,
  });

  it('separates adds, removes, and fingerprint-changed updates', () => {
    const prev = new Map([
      ['1', { name: 'KEPT', fingerprint: fingerprint(feedEntity('1', 'KEPT')) }],
      ['2', { name: 'RENAMED', fingerprint: fingerprint(feedEntity('2', 'RENAMED')) }],
      ['3', { name: 'DELISTED', fingerprint: 'x' }],
    ]);
    const d = diffSnapshot([feedEntity('1', 'KEPT'), feedEntity('2', 'NEW NAME'), feedEntity('4', 'FRESH')], prev);
    expect(d.added.map((e) => e.id)).toEqual(['4']);
    expect(d.updated.map((e) => e.id)).toEqual(['2']);
    expect(d.removed).toEqual([{ id: '3', name: 'DELISTED' }]);
  });

  it('an unchanged feed produces an empty diff — the property the old table disproves', () => {
    const feed = [feedEntity('1', 'A'), feedEntity('2', 'B')];
    const prev = new Map(feed.map((e) => [e.id, { name: e.name, fingerprint: fingerprint(e) }]));
    const d = diffSnapshot(feed, prev);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.updated).toEqual([]);
  });
});
