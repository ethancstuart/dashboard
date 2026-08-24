/**
 * UCDP GED parsing and conflict-baseline derivation — pure functions, tested.
 *
 * WHY UCDP. The conflict component ran on a dead feed: api.acleddata.com has
 * had no DNS record since ACLED retired its legacy API, so conflict was a
 * hand-set editorial floor (measured: moved in 0 of 85 countries over 90
 * days). The stored ACLED credentials DO authenticate against the new OAuth
 * endpoint but the account's read scope is denied — an owner-side portal
 * action. UCDP GED is the curated alternative: tokenless CSV downloads,
 * monthly candidate files (~1 month lag), annual curated releases.
 *
 * The lag shapes the design: monthly data cannot be a "today" signal, so
 * UCDP feeds the STRUCTURAL side — a derived conflict baseline reviewed on a
 * schedule (rule 5: derive the floor from measured fatalities, don't hand-set
 * it) — while the deviation's live-conflict slot stays reserved for a
 * real-time feed when ACLED read access is restored.
 */

/** Full-text CSV parser: handles quoted fields with embedded commas AND
 *  newlines (UCDP source_headline fields contain both), doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

export interface UcdpEvent {
  eventId: number;
  dateStart: string; // YYYY-MM-DD
  year: number;
  countryName: string;
  gwCode: number;
  iso2: string | null;
  lat: number;
  lon: number;
  deathsBest: number;
  typeOfViolence: number;
}

/** Gleditsch–Ward numeric code → ISO-2. Reference data (not a guard). */
export const GW_TO_ISO2: Record<number, string> = {
  2: 'US',
  20: 'CA',
  40: 'CU',
  41: 'HT',
  42: 'DO',
  51: 'JM',
  52: 'TT',
  70: 'MX',
  80: 'BZ',
  90: 'GT',
  91: 'HN',
  92: 'SV',
  93: 'NI',
  94: 'CR',
  95: 'PA',
  100: 'CO',
  101: 'VE',
  110: 'GY',
  115: 'SR',
  130: 'EC',
  135: 'PE',
  140: 'BR',
  145: 'BO',
  150: 'PY',
  155: 'CL',
  160: 'AR',
  165: 'UY',
  200: 'GB',
  205: 'IE',
  210: 'NL',
  211: 'BE',
  220: 'FR',
  225: 'CH',
  230: 'ES',
  235: 'PT',
  255: 'DE',
  260: 'DE',
  290: 'PL',
  305: 'AT',
  310: 'HU',
  315: 'CZ',
  316: 'SK',
  325: 'IT',
  339: 'AL',
  341: 'ME',
  343: 'MK',
  344: 'HR',
  345: 'RS',
  346: 'BA',
  349: 'SI',
  350: 'GR',
  352: 'CY',
  355: 'BG',
  359: 'MD',
  360: 'RO',
  365: 'RU',
  366: 'EE',
  367: 'LV',
  368: 'LT',
  369: 'UA',
  370: 'BY',
  371: 'AM',
  372: 'GE',
  373: 'AZ',
  375: 'FI',
  380: 'SE',
  385: 'NO',
  390: 'DK',
  402: 'CV',
  404: 'GW',
  411: 'GQ',
  420: 'GM',
  432: 'ML',
  433: 'SN',
  434: 'BJ',
  435: 'MR',
  436: 'NE',
  437: 'CI',
  438: 'GN',
  439: 'BF',
  450: 'LR',
  451: 'SL',
  452: 'GH',
  461: 'TG',
  471: 'CM',
  475: 'NG',
  481: 'GA',
  482: 'CF',
  483: 'TD',
  484: 'CG',
  490: 'CD',
  500: 'UG',
  501: 'KE',
  510: 'TZ',
  516: 'BI',
  517: 'RW',
  520: 'SO',
  522: 'DJ',
  530: 'ET',
  531: 'ER',
  540: 'AO',
  541: 'MZ',
  551: 'ZM',
  552: 'ZW',
  553: 'MW',
  560: 'ZA',
  565: 'NA',
  570: 'LS',
  571: 'BW',
  572: 'SZ',
  580: 'MG',
  581: 'KM',
  590: 'MU',
  600: 'MA',
  615: 'DZ',
  616: 'TN',
  620: 'LY',
  625: 'SD',
  626: 'SS',
  630: 'IR',
  640: 'TR',
  645: 'IQ',
  651: 'EG',
  652: 'SY',
  660: 'LB',
  663: 'JO',
  666: 'IL',
  670: 'SA',
  678: 'YE',
  690: 'KW',
  692: 'BH',
  694: 'QA',
  696: 'AE',
  698: 'OM',
  700: 'AF',
  701: 'TM',
  702: 'TJ',
  703: 'KG',
  704: 'UZ',
  705: 'KZ',
  710: 'CN',
  712: 'MN',
  713: 'TW',
  731: 'KP',
  732: 'KR',
  740: 'JP',
  750: 'IN',
  760: 'BT',
  770: 'PK',
  771: 'BD',
  775: 'MM',
  780: 'LK',
  781: 'MV',
  790: 'NP',
  800: 'TH',
  811: 'KH',
  812: 'LA',
  816: 'VN',
  820: 'MY',
  830: 'SG',
  840: 'PH',
  850: 'ID',
  860: 'TL',
  900: 'AU',
  910: 'PG',
  920: 'NZ',
  950: 'FJ',
};

/** Parse a UCDP GED/candidate CSV into events. Tolerates column reordering
 *  by reading the header row rather than assuming positions. */
export function parseUcdpCsv(text: string): { events: UcdpEvent[]; unmappedGwCodes: Map<number, number> } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { events: [], unmappedGwCodes: new Map() };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iId = col('id'),
    iDate = col('date_start'),
    iYear = col('year'),
    iCountry = col('country'),
    iGw = col('country_id'),
    iLat = col('latitude'),
    iLon = col('longitude'),
    iBest = col('best'),
    iTov = col('type_of_violence');
  if ([iId, iDate, iCountry, iGw, iBest].some((i) => i === -1)) {
    throw new Error(`ucdp_csv_missing_columns: ${header.slice(0, 10).join(',')}`);
  }

  const events: UcdpEvent[] = [];
  const unmapped = new Map<number, number>();
  for (const r of rows.slice(1)) {
    const eventId = Number.parseInt(r[iId], 10);
    if (!Number.isFinite(eventId)) continue;
    const gwCode = Number.parseInt(r[iGw], 10) || 0;
    const iso2 = GW_TO_ISO2[gwCode] ?? null;
    if (iso2 === null && gwCode > 0) unmapped.set(gwCode, (unmapped.get(gwCode) ?? 0) + 1);
    events.push({
      eventId,
      dateStart: (r[iDate] ?? '').slice(0, 10),
      year: Number.parseInt(r[iYear], 10) || 0,
      countryName: r[iCountry] ?? '',
      gwCode,
      iso2,
      lat: Number.parseFloat(r[iLat]) || 0,
      lon: Number.parseFloat(r[iLon]) || 0,
      deathsBest: Number.parseInt(r[iBest], 10) || 0,
      typeOfViolence: Number.parseInt(r[iTov], 10) || 0,
    });
  }
  return { events, unmappedGwCodes: unmapped };
}

/**
 * Trailing-12-month fatalities → derived conflict score (0–20), log scale
 * with a 25-death offset so incident-level violence doesn't read as war.
 *
 * Anchors on this curve: 100 deaths/yr ≈ 3.9 (localized violence),
 * 1,000 ≈ 8.9 (active internal conflict), ~3,000 ≈ 11.7 (Mexico's cartel
 * war), 100,000 → 20 (the worst ongoing wars). The first cut of this scale
 * had no offset and scored 100 deaths at 7.6/20 — recalibrated against the
 * real 2025-26 distribution before ever shipping.
 *
 * The scale is a judgment; the INPUT is measured — which is the entire
 * difference from the hand-set table it augments. The published baseline is
 * max(fragility floor, this) — see compute-cii.ts.
 */
export function conflictBaselineFromDeaths(trailing12moDeaths: number): number {
  if (trailing12moDeaths <= 0) return 0;
  const v = (20 * Math.log10(1 + trailing12moDeaths / 25)) / Math.log10(1 + 100_000 / 25);
  return Math.round(Math.min(20, Math.max(0, v)) * 10) / 10;
}

/** Discover candidate CSV URLs on the UCDP downloads page (derive, never
 *  hardcode a version — the version string changes monthly). */
export function extractCandidateUrls(downloadsHtml: string): string[] {
  const urls = new Set<string>();
  for (const m of downloadsHtml.matchAll(
    /href="(https:\/\/ucdp\.uu\.se\/downloads\/candidateged\/GEDEvent_[^"]+\.csv)"/gi,
  )) {
    urls.add(m[1]);
  }
  return [...urls];
}
