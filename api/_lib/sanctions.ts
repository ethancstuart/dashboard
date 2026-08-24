/**
 * Sanctions feed parsing and diffing — pure functions, tested in vitest.
 *
 * Extracted from source-ofac.ts on 2026-08-23, the day an audit found what
 * the old collector had actually produced: 116,717 rows for 1,021 distinct
 * entities — the same UN list re-inserted ~114 times, every row change_type
 * 'add', every source_date NULL (which defeats the ON CONFLICT dedup, because
 * NULL never equals NULL), every country_codes empty, and not one OFAC row
 * ever written because the OFAC endpoint had been retired (404) since before
 * the first run. The fields that would have made the data useful were in the
 * feeds all along: UN_LIST_TYPE and LISTED_ON are 100% populated in the UN
 * XML, and the OFAC CSV carries the program name on every line.
 */

export interface SanctionsEntity {
  id: string;
  name: string;
  type: string;
  /** ISO-2 country attribution derived from the sanctions regime. */
  countries: string[];
  programs: string[];
  /** UN: LISTED_ON. OFAC CSV has no per-entity date — null, caller supplies. */
  listedOn: string | null;
}

/**
 * Regime → country attribution. This is reference data, not a guard: it maps
 * a sanctions PROGRAM to the country the regime concerns, where that mapping
 * is unambiguous. Transnational regimes (Al-Qaida, ISIL, SDGT, NPWMD) map to
 * nothing rather than to a guess. UKRAINE-* programs deliberately map to
 * nothing: they name the occasion, but the designees are overwhelmingly
 * Russian, and either attribution would mislead — the program string itself
 * is shown instead.
 */
const UN_LIST_TYPE_COUNTRY: Record<string, string> = {
  DPRK: 'KP',
  DRC: 'CD',
  CAR: 'CF',
  Libya: 'LY',
  Somalia: 'SO',
  SouthSudan: 'SS',
  Sudan: 'SD',
  Yemen: 'YE',
  Haiti: 'HT',
  GB: 'GW', // Guinea-Bissau (UN's abbreviation, not Great Britain)
  Iraq: 'IQ',
  Iran: 'IR',
  Mali: 'ML',
  Taliban: 'AF',
};

const OFAC_PROGRAM_COUNTRY: Array<[RegExp, string]> = [
  [/^IRAN/, 'IR'],
  [/^CUBA/, 'CU'],
  [/^DPRK/, 'KP'],
  [/^SYRIA/, 'SY'],
  [/^VENEZUELA/, 'VE'],
  [/^BELARUS/, 'BY'],
  [/^NICARAGUA/, 'NI'],
  [/^ZIMBABWE/, 'ZW'],
  [/^BURMA/, 'MM'],
  [/^LIBYA/, 'LY'],
  [/^SOMALIA/, 'SO'],
  [/^YEMEN/, 'YE'],
  [/^IRAQ/, 'IQ'],
  [/^SOUTH SUDAN/, 'SS'],
  [/^(SUDAN|DARFUR)/, 'SD'],
  [/^DRCONGO/, 'CD'],
  [/^CAR\b/, 'CF'],
  [/^HAITI/, 'HT'],
  [/^ETHIOPIA/, 'ET'],
  [/^MALI/, 'ML'],
  [/^HONG ?KONG/, 'HK'],
];

export function unListTypeCountry(listType: string): string | null {
  return UN_LIST_TYPE_COUNTRY[listType] ?? null;
}

export function ofacProgramCountries(programs: string[]): string[] {
  const out = new Set<string>();
  for (const p of programs) {
    for (const [re, cc] of OFAC_PROGRAM_COUNTRY) {
      if (re.test(p.trim().toUpperCase())) out.add(cc);
    }
  }
  return [...out].sort();
}

/**
 * Parse one line of OFAC's SDN.CSV. Classic 12-column format:
 * ent_num, name, type, program, title, call_sign, vess_type, tonnage, grt,
 * vess_flag, vess_owner, remarks — quoted fields, `-0-` as the null marker.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else cur += ch;
  }
  fields.push(cur);
  return fields.map((f) => {
    const t = f.trim();
    return t === '-0-' ? '' : t;
  });
}

export function parseOfacCsv(csv: string): SanctionsEntity[] {
  const out: SanctionsEntity[] = [];
  for (const line of csv.split('\n')) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    if (f.length < 4 || !/^\d+$/.test(f[0])) continue;
    const programs = f[3]
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean);
    out.push({
      id: f[0],
      name: f[1] || 'unknown',
      type: (f[2] || 'entity').toLowerCase(),
      countries: ofacProgramCountries(programs),
      programs,
      listedOn: null,
    });
  }
  return out;
}

/** Parse the UN consolidated XML (regex block extraction — no XML dep). */
export function parseUnXml(xml: string): SanctionsEntity[] {
  const out: SanctionsEntity[] = [];
  const field = (block: string, tag: string): string | null =>
    block.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1]?.trim() ?? null;

  const push = (block: string, type: 'individual' | 'entity') => {
    const id = field(block, 'DATAID');
    if (!id) return;
    const first = field(block, 'FIRST_NAME') ?? '';
    const second = type === 'individual' ? (field(block, 'SECOND_NAME') ?? '') : '';
    const listType = field(block, 'UN_LIST_TYPE');
    const ref = field(block, 'REFERENCE_NUMBER');
    const cc = listType ? unListTypeCountry(listType) : null;
    out.push({
      id,
      name: `${first} ${second}`.trim() || 'unknown',
      type,
      countries: cc ? [cc] : [],
      programs: [listType, ref].filter((x): x is string => x !== null),
      listedOn: field(block, 'LISTED_ON'),
    });
  };

  for (const m of xml.matchAll(/<INDIVIDUAL>([\s\S]*?)<\/INDIVIDUAL>/g)) push(m[1], 'individual');
  for (const m of xml.matchAll(/<ENTITY>([\s\S]*?)<\/ENTITY>/g)) push(m[1], 'entity');
  return out;
}

/** Stable content fingerprint — a changed fingerprint is an 'update' event. */
export function fingerprint(e: SanctionsEntity): string {
  return [e.name, e.type, e.countries.join(','), e.programs.join(',')].join('|');
}

export interface SanctionsDiff {
  added: SanctionsEntity[];
  removed: Array<{ id: string; name: string }>;
  updated: SanctionsEntity[];
}

/**
 * Diff the current feed against the previously stored snapshot. This is the
 * fix for the fictional diff: the old collector marked EVERY entity 'add' on
 * every changed snapshot, so "what changed" was unanswerable from the table.
 */
export function diffSnapshot(
  feed: SanctionsEntity[],
  previous: Map<string, { name: string; fingerprint: string }>,
): SanctionsDiff {
  const added: SanctionsEntity[] = [];
  const updated: SanctionsEntity[] = [];
  const seen = new Set<string>();
  for (const e of feed) {
    seen.add(e.id);
    const prev = previous.get(e.id);
    if (!prev) added.push(e);
    else if (prev.fingerprint !== fingerprint(e)) updated.push(e);
  }
  const removed = [...previous.entries()].filter(([id]) => !seen.has(id)).map(([id, p]) => ({ id, name: p.name }));
  return { added, removed, updated };
}
