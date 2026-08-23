import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

export const config = { runtime: 'nodejs', maxDuration: 120 };

/**
 * World Bank Worldwide Governance Indicators ingestion (monthly).
 *
 * WHY THIS EXISTS RATHER THAN source-vdem. The CII's governance component is
 * 15% of the score and is `max(hardcoded_baseline, f(conflict)) + ooni_bump`,
 * with the hardcoded table covering 20 of 85 countries and the rest starting at
 * zero. `vdem_indicators` was meant to fix that and holds zero rows —
 * api/cron/source-vdem.ts is a scaffold that returns `{skipped: true}` every
 * month by design, because V-Dem's only free distribution is a ~200MB zipped
 * CSV / binary .rds that a serverless function cannot ingest, and the
 * VDEM_DATA_URL it waits for was never set.
 *
 * DEVIATION, FLAGGED: this is World Bank WGI, not V-Dem. Same intent — a real,
 * independent, per-country governance measure replacing a table somebody typed
 * — through a mechanism that works: free, no key, JSON, six dimensions, 2024
 * data, and 84 of our 85 CII countries (Taiwan excepted; the World Bank does
 * not list it).
 *
 * WGI estimates run approximately -2.5 (weak) to +2.5 (strong). HIGHER IS
 * BETTER, which is the opposite polarity to a risk score — inverting it is the
 * consumer's job, and the column comment says so.
 *
 * `mrnev=1` asks for each country's most recent non-empty value, so a country
 * whose latest year is missing falls back to its previous one rather than
 * disappearing.
 */

/** The six WGI dimensions, mapped to readable names we store. */
const INDICATORS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'GOV_WGI_VA.EST', name: 'voice_accountability' },
  { code: 'GOV_WGI_PV.EST', name: 'political_stability' },
  { code: 'GOV_WGI_GE.EST', name: 'government_effectiveness' },
  { code: 'GOV_WGI_RQ.EST', name: 'regulatory_quality' },
  { code: 'GOV_WGI_RL.EST', name: 'rule_of_law' },
  { code: 'GOV_WGI_CC.EST', name: 'control_of_corruption' },
];

const SOURCE = 'worldbank-wgi';

interface WbRow {
  country: { id: string; value: string };
  date: string;
  value: number | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (token !== process.env.CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'database_not_configured' });
  const sql = neon(dbUrl);

  const summary: Record<string, number> = {};
  const failures: string[] = [];

  for (const ind of INDICATORS) {
    try {
      const url =
        `https://api.worldbank.org/v2/country/all/indicator/${ind.code}` + `?format=json&source=3&per_page=400&mrnev=1`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) {
        failures.push(`${ind.name}: HTTP ${resp.status}`);
        continue;
      }

      const body = (await resp.json()) as [unknown, WbRow[] | null];
      const rows = Array.isArray(body) ? (body[1] ?? []) : [];
      let written = 0;

      for (const r of rows) {
        // country.id is ISO-2, which is what cii_daily_snapshots uses.
        // Aggregates (regions, income groups) come back with non-ISO ids, so
        // require exactly two uppercase letters rather than filtering a list of
        // aggregate names that the World Bank can extend at any time.
        const code = r.country?.id ?? '';
        if (!/^[A-Z]{2}$/.test(code)) continue;
        if (r.value === null || !Number.isFinite(r.value)) continue;
        const year = Number.parseInt(r.date, 10);
        if (!Number.isFinite(year)) continue;

        await sql`
          INSERT INTO governance_indicators (country_code, year, indicator, value, source, observed_at)
          VALUES (${code}, ${year}, ${ind.name}, ${r.value}, ${SOURCE}, NOW())
          ON CONFLICT (country_code, year, indicator, source) DO UPDATE
            SET value = EXCLUDED.value, observed_at = NOW()
        `;
        written++;
      }
      summary[ind.name] = written;
    } catch (err) {
      failures.push(`${ind.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  console.log(`[source-worldbank-governance] wrote ${total} rows`, summary, failures);

  // Fail loudly when NOTHING landed. A collector that returns 200 while writing
  // zero rows is exactly how vdem_indicators sat empty for months without
  // anyone noticing.
  if (total === 0) {
    return res.status(500).json({ error: 'no_rows_written', summary, failures });
  }

  return res.status(200).json({ ok: true, total, summary, failures });
}
